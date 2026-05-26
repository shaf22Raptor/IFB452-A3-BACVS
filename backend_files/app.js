const DEFAULT_VERIFICATION_CONTRACT_ADDRESS =
    "0xe2751b15d11ac9eAb0A8f9852808FBf65A45785A";

const CredentialStatus = {
    0: "Unknown",
    1: "Active",
    2: "Cancelled",
    3: "Superseded"
};

const VerificationContractABI = [
    "function credentialRegistry() view returns (address)",
    "function institutionRegistry() view returns (address)",
    "function lifecycleAndAccessControl() view returns (address)",
    "function verifyCredential(bytes32 credentialId) returns (bool)",
    "function compareDocumentHash(bytes32 credentialId, bytes32 suppliedDocumentHash) returns (bool)",
    "function getCredentialStatus(bytes32 credentialId) view returns (uint8)",
    "function getCredentialMetadata(bytes32 credentialId) view returns (tuple(address issuer,address holder,bytes32 studentReference,bytes32 documentHash,string credentialType,uint256 issuedAt,uint8 status,bytes32 replacementCredentialId))"
];

const InstitutionRegistryABI = [
    "function registerInstitution(address institution, string name)",
    "function deactivateInstitution(address institution)",
    "function verifyInstitution(address institution) view returns (bool)",
    "function getInstitution(address institution) view returns (tuple(string name,bool active,uint256 registeredAt,uint256 deactivatedAt))"
];

const CredentialRegistryABI = [
    "event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed holder, bytes32 studentReference, string credentialType)",
    "function setLifecycleContract(address newLifecycleContract)",
    "function setVerificationContract(address newVerificationContract)",
    "function issueCredential(address holder,bytes32 studentReference,bytes32 documentHash,string credentialType) returns (bytes32)",
    "function getCredential(bytes32 credentialId) view returns (tuple(address issuer,address holder,bytes32 studentReference,bytes32 documentHash,string credentialType,uint256 issuedAt,uint8 status,bytes32 replacementCredentialId))",
    "function getMyIssuerCredentials() view returns (tuple(bytes32 credentialId, tuple(address issuer,address holder,bytes32 studentReference,bytes32 documentHash,string credentialType,uint256 issuedAt,uint8 status,bytes32 replacementCredentialId) credential)[])",
    "function getMyHolderCredentials() view returns (tuple(bytes32 credentialId, tuple(address issuer,address holder,bytes32 studentReference,bytes32 documentHash,string credentialType,uint256 issuedAt,uint8 status,bytes32 replacementCredentialId) credential)[])",
    "function lifecycleContract() view returns (address)",
    "function verificationContract() view returns (address)"
];

const LifecycleAndAccessControlABI = [
    "event CredentialReplaced(bytes32 indexed oldCredentialId, bytes32 indexed newCredentialId, address indexed issuer)",
    "function revokeCredential(bytes32 credentialId)",
    "function replaceCredential(bytes32 oldCredentialId, bytes32 studentReference, bytes32 documentHash, string credentialType) returns (bytes32)",
    "function grantAccess(bytes32 credentialId, address verifier)",
    "function revokeAccess(bytes32 credentialId, address verifier)",
    "function hasAccess(bytes32 credentialId, address verifier) view returns (bool)"
];

let provider;
let signer;
let account;
let VerificationContract;
let InstitutionRegistry;
let CredentialRegistry;
let LifecycleAndAccessControl;
let contractAddresses;

window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("contractAddress").value =
        DEFAULT_VERIFICATION_CONTRACT_ADDRESS;
    applyDemoCredentialValues();
});

function showResult(message, isError = false) {
    document.getElementById("result").innerHTML = `<pre class="${isError ? "error" : "success"}">${message}</pre>`;
}

async function copyDemoValue(elementId) {
    const value = document.getElementById(elementId).textContent.trim();
    await navigator.clipboard.writeText(value);
    showResult(`Copied:\n${value}`);
}

function applyDemoCredentialValues() {
    document.getElementById("credentialId").value = "";
    document.getElementById("documentHash").value =
        document.getElementById("demoDocumentHash").textContent.trim();
    document.getElementById("studentReference").value =
        document.getElementById("demoStudentReference").textContent.trim();
    document.getElementById("credentialType").value =
        "Bachelor of Information Technology";
}

function applyDemoAddresses() {
    const institution = document.getElementById("institutionAccount").value.trim();
    const student = document.getElementById("studentAccount").value.trim();
    const verifier = document.getElementById("verifierAccount").value.trim();

    if (institution) {
        document.getElementById("institutionAddress").value = institution;
    }
    if (student) {
        document.getElementById("holderAddress").value = student;
    }
    if (verifier) {
        document.getElementById("verifierAddress").value = verifier;
    }
    document.getElementById("institutionName").value = "Example University";

    showResult("Address inputs filled from Demo Values.");
}

function requireContracts() {
    if (!VerificationContract) {
        throw new Error("Connect wallet and load the verification contract first.");
    }
}

function getCredentialId() {
    return document.getElementById("credentialId").value.trim();
}

function requireAddress(value, label) {
    const address = value.trim();
    if (!ethers.utils.isAddress(address)) {
        throw new Error(`${label} must be a valid wallet address.`);
    }
    return address;
}

function requireBytes32(value, label) {
    const bytes32 = value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(bytes32)) {
        throw new Error(`${label} must be exactly 0x followed by 64 hex characters.`);
    }
    if (bytes32 === ethers.constants.HashZero) {
        throw new Error(`${label} cannot be zero.`);
    }
    return bytes32;
}

function requireText(value, label) {
    const text = value.trim();
    if (!text) {
        throw new Error(`${label} is required.`);
    }
    return text;
}

function formatDate(value) {
    const timestamp = value.toNumber ? value.toNumber() : Number(value);
    return new Date(timestamp * 1000).toLocaleString();
}

function formatCredential(credential) {
    return [
        `Issuer: ${credential.issuer}`,
        `Holder: ${credential.holder}`,
        `Student Reference: ${credential.studentReference}`,
        `Document Hash: ${credential.documentHash}`,
        `Credential Type: ${credential.credentialType}`,
        `Issued At: ${formatDate(credential.issuedAt)}`,
        `Status: ${CredentialStatus[Number(credential.status)]}`,
        `Replacement ID: ${credential.replacementCredentialId}`
    ].join("\n");
}

function formatCredentialRecord(record) {
    const credentialId = record.credentialId || record[0];
    const credential = record.credential || record[1];

    return [`Credential ID: ${credentialId}`, formatCredential(credential)].join("\n");
}

async function waitFor(tx, label) {
    showResult(`${label} transaction submitted:\n${tx.hash}`);
    await tx.wait();
    showResult(`${label} confirmed:\n${tx.hash}`);
}

async function connectWallet() {
    try {
        if (!window.ethereum) {
            throw new Error("MetaMask is not available in this browser.");
        }

        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        account = await signer.getAddress();

        const verificationAddress = document
            .getElementById("contractAddress")
            .value.trim();
        if (!ethers.utils.isAddress(verificationAddress)) {
            throw new Error("Verification contract address is not a valid address.");
        }

        const deployedCode = await provider.getCode(verificationAddress);
        if (deployedCode === "0x") {
            throw new Error(
                "No contract exists at this address on the currently selected MetaMask network. Check that MetaMask is on the same network used for Remix deployment."
            );
        }

        VerificationContract = new ethers.Contract(
            verificationAddress,
            VerificationContractABI,
            signer
        );

        let credentialRegistryAddress;
        let institutionRegistryAddress;
        let lifecycleAddress;

        try {
            credentialRegistryAddress =
                await VerificationContract.credentialRegistry();
            institutionRegistryAddress =
                await VerificationContract.institutionRegistry();
            lifecycleAddress =
                await VerificationContract.lifecycleAndAccessControl();
        } catch (error) {
            throw new Error(
                "The address has contract code, but it does not behave like VerificationContract. Make sure you pasted the deployed VerificationContract address, not CredentialRegistry, InstitutionRegistry, or LifecycleAndAccessControl."
            );
        }

        contractAddresses = {
            verification: verificationAddress,
            credentialRegistry: credentialRegistryAddress,
            institutionRegistry: institutionRegistryAddress,
            lifecycle: lifecycleAddress
        };
        loadContractsWithSigner();

        document.getElementById("account").textContent = account;
        document.getElementById("institutionAddressDisplay").textContent =
            institutionRegistryAddress;
        document.getElementById("credentialAddressDisplay").textContent =
            credentialRegistryAddress;
        document.getElementById("lifecycleAddressDisplay").textContent =
            lifecycleAddress;

        showResult("Connected and loaded linked contracts.");
    } catch (error) {
        console.error(error);
        showResult(error.message, true);
    }
}

function loadContractsWithSigner() {
    VerificationContract = new ethers.Contract(
        contractAddresses.verification,
        VerificationContractABI,
        signer
    );
    CredentialRegistry = new ethers.Contract(
        contractAddresses.credentialRegistry,
        CredentialRegistryABI,
        signer
    );
    InstitutionRegistry = new ethers.Contract(
        contractAddresses.institutionRegistry,
        InstitutionRegistryABI,
        signer
    );
    LifecycleAndAccessControl = new ethers.Contract(
        contractAddresses.lifecycle,
        LifecycleAndAccessControlABI,
        signer
    );
}

async function syncSelectedAccount() {
    if (!provider || !contractAddresses) {
        return false;
    }

    signer = provider.getSigner();
    account = await signer.getAddress();
    loadContractsWithSigner();
    document.getElementById("account").textContent = account;
    return true;
}

if (window.ethereum) {
    window.ethereum.on("accountsChanged", async (accounts) => {
        if (!accounts.length) {
            account = undefined;
            signer = undefined;
            VerificationContract = undefined;
            InstitutionRegistry = undefined;
            CredentialRegistry = undefined;
            LifecycleAndAccessControl = undefined;
            contractAddresses = undefined;
            document.getElementById("account").textContent = "Not connected";
            showResult("MetaMask account disconnected. Connect wallet again.");
            return;
        }

        try {
            const synced = await syncSelectedAccount();
            if (synced) {
                showResult(`MetaMask account changed:\n${account}`);
            }
        } catch (error) {
            console.error(error);
            showResult(error.reason || error.message, true);
        }
    });
}

async function linkContracts() {
    try {
        requireContracts();
        const lifecycleAddress =
            await VerificationContract.lifecycleAndAccessControl();
        const verificationAddress = VerificationContract.address;

        const lifecycleCurrent = await CredentialRegistry.lifecycleContract();
        if (lifecycleCurrent === ethers.constants.AddressZero) {
            await waitFor(
                await CredentialRegistry.setLifecycleContract(lifecycleAddress),
                "Lifecycle link"
            );
        }

        const verificationCurrent =
            await CredentialRegistry.verificationContract();
        if (verificationCurrent === ethers.constants.AddressZero) {
            await waitFor(
                await CredentialRegistry.setVerificationContract(
                    verificationAddress
                ),
                "Verification link"
            );
        }

        showResult("Registry links are configured.");
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function registerInstitution() {
    try {
        requireContracts();
        const institution = document.getElementById("institutionAddress").value;
        const name = document.getElementById("institutionName").value;
        await waitFor(
            await InstitutionRegistry.registerInstitution(institution, name),
            "Institution registration"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function deactivateInstitution() {
    try {
        requireContracts();
        const institution = document.getElementById("institutionAddress").value;
        await waitFor(
            await InstitutionRegistry.deactivateInstitution(institution),
            "Institution deactivation"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function issueCredential() {
    try {
        requireContracts();
        const holder = requireAddress(
            document.getElementById("holderAddress").value,
            "Student holder address"
        );
        const studentReference = requireBytes32(
            document.getElementById("studentReference").value,
            "Student reference"
        );
        const documentHash = requireBytes32(
            document.getElementById("documentHash").value,
            "Document hash"
        );
        const credentialType = requireText(
            document.getElementById("credentialType").value,
            "Credential type"
        );

        const predictedCredentialId =
            await CredentialRegistry.callStatic.issueCredential(
                holder,
                studentReference,
                documentHash,
                credentialType
            );

        const tx = await CredentialRegistry.issueCredential(
            holder,
            studentReference,
            documentHash,
            credentialType
        );
        showResult(`Credential issuance transaction submitted:\n${tx.hash}`);

        const receipt = await tx.wait();
        const issuedEvent = receipt.logs
            .map((log) => {
                try {
                    return CredentialRegistry.interface.parseLog(log);
                } catch (error) {
                    return null;
                }
            })
            .find((event) => event && event.name === "CredentialIssued");
        const credentialId = issuedEvent
            ? issuedEvent.args.credentialId
            : predictedCredentialId;

        document.getElementById("credentialId").value = credentialId;
        showResult(
            [
                `Credential issuance confirmed:\n${tx.hash}`,
                `Generated Credential ID: ${credentialId}`,
                "",
                `Issuer: ${account}`,
                `Holder: ${holder}`,
                `Student Reference: ${studentReference}`,
                `Document Hash: ${documentHash}`,
                `Credential Type: ${credentialType}`
            ].join("\n")
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function revokeCredential() {
    try {
        requireContracts();
        await waitFor(
            await LifecycleAndAccessControl.revokeCredential(getCredentialId()),
            "Credential revocation"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function replaceCredential() {
    try {
        requireContracts();
        const oldCredentialId = requireBytes32(
            getCredentialId(),
            "Credential ID"
        );
        const studentReference = requireBytes32(
            document.getElementById("studentReference").value,
            "Replacement student reference"
        );
        const documentHash = requireBytes32(
            document.getElementById("documentHash").value,
            "Replacement document hash"
        );
        const credentialType = requireText(
            document.getElementById("credentialType").value,
            "Replacement credential type"
        );

        const predictedCredentialId =
            await LifecycleAndAccessControl.callStatic.replaceCredential(
                oldCredentialId,
                studentReference,
                documentHash,
                credentialType
            );

        const tx = await LifecycleAndAccessControl.replaceCredential(
            oldCredentialId,
            studentReference,
            documentHash,
            credentialType
        );
        showResult(`Credential replacement transaction submitted:\n${tx.hash}`);

        const receipt = await tx.wait();
        const replacedEvent = receipt.logs
            .map((log) => {
                try {
                    return LifecycleAndAccessControl.interface.parseLog(log);
                } catch (error) {
                    return null;
                }
            })
            .find((event) => event && event.name === "CredentialReplaced");
        const newCredentialId = replacedEvent
            ? replacedEvent.args.newCredentialId
            : predictedCredentialId;

        showResult(
            [
                `Credential replacement confirmed:\n${tx.hash}`,
                `Old Credential ID: ${oldCredentialId}`,
                `Generated Replacement Credential ID: ${newCredentialId}`,
                "",
                `Replacement Student Reference: ${studentReference}`,
                `Replacement Document Hash: ${documentHash}`,
                `Replacement Credential Type: ${credentialType}`
            ].join("\n")
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function grantAccess() {
    try {
        requireContracts();
        const verifier = document.getElementById("verifierAddress").value;
        await waitFor(
            await LifecycleAndAccessControl.grantAccess(
                getCredentialId(),
                verifier
            ),
            "Access grant"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function revokeAccess() {
    try {
        requireContracts();
        const verifier = document.getElementById("verifierAddress").value;
        await waitFor(
            await LifecycleAndAccessControl.revokeAccess(
                getCredentialId(),
                verifier
            ),
            "Access revocation"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function checkAccess() {
    try {
        requireContracts();
        const verifier = document.getElementById("verifierAddress").value;
        const hasAccess = await LifecycleAndAccessControl.hasAccess(
            getCredentialId(),
            verifier
        );
        showResult(`Access granted: ${hasAccess}`);
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function verifyCredential() {
    try {
        requireContracts();
        await waitFor(
            await VerificationContract.verifyCredential(getCredentialId()),
            "Credential verification"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function checkCredentialStatus() {
    try {
        requireContracts();
        const statusCode = await VerificationContract.getCredentialStatus(
            getCredentialId()
        );
        showResult(`Credential Status: ${CredentialStatus[Number(statusCode)]}`);
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function compareDocumentHash() {
    try {
        requireContracts();
        const documentHash = document.getElementById("documentHash").value;
        await waitFor(
            await VerificationContract.compareDocumentHash(
                getCredentialId(),
                documentHash
            ),
            "Document hash comparison"
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function getCredentialMetadata() {
    try {
        requireContracts();
        const credential = await VerificationContract.getCredentialMetadata(
            getCredentialId()
        );
        showResult(formatCredential(credential));
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function getMyHolderCredentials() {
    try {
        requireContracts();
        const credentialRecords = await CredentialRegistry.getMyHolderCredentials();
        showResult(
            credentialRecords.length
                ? credentialRecords.map(formatCredentialRecord).join("\n\n")
                : "No credentials found for connected holder."
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}

async function getMyIssuerCredentials() {
    try {
        requireContracts();
        const credentialRecords = await CredentialRegistry.getMyIssuerCredentials();
        showResult(
            credentialRecords.length
                ? credentialRecords.map(formatCredentialRecord).join("\n\n")
                : "No credentials found for connected issuer."
        );
    } catch (error) {
        console.error(error);
        showResult(error.reason || error.message, true);
    }
}
