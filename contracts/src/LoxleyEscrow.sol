// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";

/**
 * @title LoxleyEscrow
 * @notice Per-request escrow for x402 payments with an attested release.
 *
 * A payer signs one Permit2 witness transfer that locks the exact call price in this contract,
 * bound to a request id, a payee, an attestor, a deadline and a response-schema hash. The payee
 * serves the request. An attestor (normally the facilitator that fronted the call) signs a Receipt
 * saying whether the response was acceptable. Anyone submits that receipt:
 *
 *   accepted  -> funds go to the payee (minus the protocol fee, if any)
 *   rejected  -> funds go back to the payer
 *   silence   -> after the deadline anyone can reclaim the funds for the payer
 *
 * Nothing here is upgradeable, pausable, or owned. The only privileged party is the attestor the
 * payer named in the signature, and the payer chose them.
 */
contract LoxleyEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Released,
        Refunded,
        Reclaimed
    }

    struct Lock {
        address payer;
        address payee;
        address attestor;
        address token;
        uint96 amount;
        uint64 deadline;
        bytes32 schemaHash;
        Status status;
    }

    /// @notice Witness the payer signs inside the Permit2 permit. Binds every escrow parameter.
    struct EscrowWitness {
        bytes32 requestId;
        address payee;
        address attestor;
        uint64 deadline;
        bytes32 schemaHash;
    }

    /// @notice What the attestor signs after inspecting the response.
    struct Receipt {
        bytes32 requestId;
        bytes32 responseHash;
        uint16 status;
        bool accepted;
    }

    string public constant WITNESS_TYPE_STRING =
        "EscrowWitness witness)EscrowWitness(bytes32 requestId,address payee,address attestor,uint64 deadline,bytes32 schemaHash)TokenPermissions(address token,uint256 amount)";
    bytes32 public constant WITNESS_TYPEHASH =
        keccak256("EscrowWitness(bytes32 requestId,address payee,address attestor,uint64 deadline,bytes32 schemaHash)");
    bytes32 public constant RECEIPT_TYPEHASH =
        keccak256("Receipt(bytes32 requestId,bytes32 responseHash,uint16 status,bool accepted)");

    uint256 public constant MAX_FEE_BPS = 500;

    ISignatureTransfer public immutable PERMIT2;
    uint256 public immutable feeBps;
    address public immutable feeRecipient;

    mapping(bytes32 requestId => Lock) private _locks;

    event Opened(
        bytes32 indexed requestId,
        address indexed payer,
        address indexed payee,
        address attestor,
        address token,
        uint256 amount,
        uint64 deadline,
        bytes32 schemaHash
    );
    event Released(bytes32 indexed requestId, address indexed payee, uint256 amount, uint256 fee, bytes32 responseHash, uint16 status);
    event Refunded(bytes32 indexed requestId, address indexed payer, uint256 amount, bytes32 responseHash, uint16 status);
    event Reclaimed(bytes32 indexed requestId, address indexed payer, uint256 amount);

    error InvalidPermit2();
    error InvalidFee();
    error InvalidPayee();
    error InvalidAttestor();
    error InvalidAmount();
    error DeadlinePassed();
    error RequestExists(bytes32 requestId);
    error NotOpen(bytes32 requestId);
    error NotExpired(bytes32 requestId);
    error BadReceipt();
    error ReceiptVerdictMismatch();
    error PermittedMismatch();

    constructor(address permit2_, uint256 feeBps_, address feeRecipient_) EIP712("LoxleyEscrow", "1") {
        if (permit2_ == address(0)) revert InvalidPermit2();
        if (feeBps_ > MAX_FEE_BPS || (feeBps_ > 0 && feeRecipient_ == address(0))) revert InvalidFee();
        PERMIT2 = ISignatureTransfer(permit2_);
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

    /**
     * @notice Lock a payment. Callable by anyone holding the payer's Permit2 signature (normally the facilitator),
     *         so the payer never spends gas.
     * @param permit   Permit2 transfer: token + exact amount, the payer's unordered nonce, the signature deadline.
     * @param payer    Token owner who signed.
     * @param witness  Escrow terms the payer signed over.
     * @param signature Permit2 signature over (permit, spender = this, witness).
     */
    function open(
        ISignatureTransfer.PermitTransferFrom calldata permit,
        address payer,
        EscrowWitness calldata witness,
        bytes calldata signature
    ) external nonReentrant {
        if (witness.payee == address(0)) revert InvalidPayee();
        if (witness.attestor == address(0)) revert InvalidAttestor();
        if (permit.permitted.amount == 0 || permit.permitted.amount > type(uint96).max) revert InvalidAmount();
        if (witness.deadline <= block.timestamp) revert DeadlinePassed();
        if (_locks[witness.requestId].status != Status.None) revert RequestExists(witness.requestId);

        _locks[witness.requestId] = Lock({
            payer: payer,
            payee: witness.payee,
            attestor: witness.attestor,
            token: permit.permitted.token,
            amount: uint96(permit.permitted.amount),
            deadline: witness.deadline,
            schemaHash: witness.schemaHash,
            status: Status.Open
        });

        bytes32 witnessHash = keccak256(
            abi.encode(WITNESS_TYPEHASH, witness.requestId, witness.payee, witness.attestor, witness.deadline, witness.schemaHash)
        );
        PERMIT2.permitWitnessTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: permit.permitted.amount}),
            payer,
            witnessHash,
            WITNESS_TYPE_STRING,
            signature
        );

        emit Opened(
            witness.requestId,
            payer,
            witness.payee,
            witness.attestor,
            permit.permitted.token,
            permit.permitted.amount,
            witness.deadline,
            witness.schemaHash
        );
    }

    /// @notice Pay the payee. Requires the attestor's signed Receipt with accepted = true.
    function release(Receipt calldata receipt, bytes calldata attestorSignature) external nonReentrant {
        if (!receipt.accepted) revert ReceiptVerdictMismatch();
        Lock storage lock = _requireOpenAttested(receipt, attestorSignature);
        lock.status = Status.Released;

        uint256 amount = lock.amount;
        uint256 fee = (amount * feeBps) / 10_000;
        if (fee > 0) IERC20(lock.token).safeTransfer(feeRecipient, fee);
        IERC20(lock.token).safeTransfer(lock.payee, amount - fee);

        emit Released(receipt.requestId, lock.payee, amount - fee, fee, receipt.responseHash, receipt.status);
    }

    /// @notice Return funds to the payer. Requires the attestor's signed Receipt with accepted = false.
    function refund(Receipt calldata receipt, bytes calldata attestorSignature) external nonReentrant {
        if (receipt.accepted) revert ReceiptVerdictMismatch();
        Lock storage lock = _requireOpenAttested(receipt, attestorSignature);
        lock.status = Status.Refunded;

        IERC20(lock.token).safeTransfer(lock.payer, lock.amount);
        emit Refunded(receipt.requestId, lock.payer, lock.amount, receipt.responseHash, receipt.status);
    }

    /// @notice After the deadline with no receipt, anyone can send the funds back to the payer.
    function reclaim(bytes32 requestId) external nonReentrant {
        Lock storage lock = _locks[requestId];
        if (lock.status != Status.Open) revert NotOpen(requestId);
        if (block.timestamp <= lock.deadline) revert NotExpired(requestId);
        lock.status = Status.Reclaimed;

        IERC20(lock.token).safeTransfer(lock.payer, lock.amount);
        emit Reclaimed(requestId, lock.payer, lock.amount);
    }

    function getLock(bytes32 requestId) external view returns (Lock memory) {
        return _locks[requestId];
    }

    /// @notice EIP-712 digest an attestor signs for a Receipt.
    function receiptDigest(Receipt calldata receipt) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(RECEIPT_TYPEHASH, receipt.requestId, receipt.responseHash, receipt.status, receipt.accepted))
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _requireOpenAttested(Receipt calldata receipt, bytes calldata attestorSignature)
        internal
        view
        returns (Lock storage lock)
    {
        lock = _locks[receipt.requestId];
        if (lock.status != Status.Open) revert NotOpen(receipt.requestId);
        if (!SignatureChecker.isValidSignatureNow(lock.attestor, receiptDigest(receipt), attestorSignature)) {
            revert BadReceipt();
        }
    }
}
