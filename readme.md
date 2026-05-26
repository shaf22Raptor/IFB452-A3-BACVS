# Credential Verification dApp Setup

This project has two parts:

- Smart contracts in `sol_files/CredentialAuthority.sol`, deployed through Remix.
- A local HTML frontend in `index.html`, with browser logic in `backend_files/app.js`.

## 1. Backend: deploy the Solidity contracts in Remix
You may deploy the solidity program through various means. The below is the **suggested** method:

1. Open [Remix](https://remix.ethereum.org/).
2. Create or upload `sol_files/CredentialAuthority.sol`.
3. Go to the **Solidity Compiler** tab.
4. Compile the file using Solidity `0.8.20` or another compatible `0.8.x` compiler.
5. Go to the **Deploy & Run Transactions** tab.
6. Choose the environment you want to use.

Important wallet/network advice:

- If you want the local frontend to interact with the contracts, deploy to a network your browser wallet can also access.
- The easiest option is usually **Injected Provider - MetaMask** in Remix.
- Make sure MetaMask is connected to the same account and network used for deployment.
- Remix VM deployments are useful for quick contract testing inside Remix, but the frontend usually cannot access those contracts through MetaMask.
- Keep some test ETH in the deploying wallet for gas if using a testnet or local chain.

## 2. Contract deployment order and constructor arguments

Deploy the contracts in this exact order.

### 1. `InstitutionRegistry`

Constructor arguments: none.

Deploy this first. The wallet that deploys it becomes the accreditation authority. This account is the only account that can register or deactivate institutions.

Copy the deployed `InstitutionRegistry` address.

### 2. `CredentialRegistry`

Constructor arguments:

```text
institutionRegistryAddress
```

Use the deployed `InstitutionRegistry` address from step 1.

Copy the deployed `CredentialRegistry` address.

### 3. `LifecycleAndAccessControl`

Constructor arguments:

```text
credentialRegistryAddress
```

Use the deployed `CredentialRegistry` address from step 2.

Copy the deployed `LifecycleAndAccessControl` address.

### 4. `VerificationContract`

Constructor arguments:

```text
credentialRegistryAddress
institutionRegistryAddress
lifecycleAndAccessControlAddress
```

Use:

- `credentialRegistryAddress`: the deployed `CredentialRegistry` address.
- `institutionRegistryAddress`: the deployed `InstitutionRegistry` address.
- `lifecycleAndAccessControlAddress`: the deployed `LifecycleAndAccessControl` address.

Copy the deployed `VerificationContract` address. This is the main address the frontend asks for.

## 3. Link the registry contracts

After deployment, `CredentialRegistry` must be linked to the lifecycle and verification contracts.

You can do this from the frontend by clicking **Link Registry Contracts** after connecting with the wallet that deployed `CredentialRegistry`.

Alternatively, do it manually in Remix by calling these functions on the deployed `CredentialRegistry` contract:

```text
setLifecycleContract(lifecycleAndAccessControlAddress)
setVerificationContract(verificationContractAddress)
```

Both calls must be made from the `CredentialRegistry` deployer account. Each function can only be set once.

## 4. Frontend setup

Install dependencies:

```bash
npm install
```

Start the local frontend:

```bash
npm start
```

The app is served by `lite-server`. It will usually open at:

```text
http://localhost:3000
```

If it does not open automatically, copy the local URL printed in the terminal into your browser.

## 5. Connect your wallet in the app
This step can be done in several different ways depending on how you wish to configure your wallet. The suggested process is outlined below:
1. Open the frontend in a browser with MetaMask installed.
2. Confirm MetaMask is on the same network used in Remix.
3. Paste the deployed `VerificationContract` address into the **Verification Contract Address** field.
4. Click **Connect Wallet**.
5. Approve the MetaMask connection request.

**Note:** Throughout app usage, you may be prompted by MetaMask to approve transactions. You may also have to have the front-end app open in the same browser as where you deployed your Solidity program.

## 6. Suggested test flow

Upon following the above instructions, you may follow the below suggested test flow:
1. Register an institution from the **Admin** tab.
2. Switch MetaMask to the registered institution wallet.
3. Issue a credential from the **Issuer** tab.
4. Copy the generated credential ID.
5. Switch MetaMask to the student holder wallet.
6. Grant verifier access from the **Holder** tab.
7. Switch MetaMask to the verifier wallet.
8. Verify the credential, compare the document hash, or fetch metadata from the **Verifier** tab.
