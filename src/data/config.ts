// Testnet only. Never point this app at mainnet.
export const TESTNET = {
  contractId:
    import.meta.env.VITE_CONTRACT_ID ?? "CDO5G5UK4YLRCBXWJI7GSJYTPXZSZNCAQ4ILAKZHYUBA64QWWCUTF22Z",
  rpcUrl: import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
