// Wallet tools (run on the droplet):
//   npm run wallet -- create   → make Clippy's wallet (data/wallet.json, private key never printed)
//   npm run wallet -- info     → address, network, balances
//   npm run wallet -- airdrop  → devnet only: get 1 free test SOL
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
(async () => {
  const w = await import("../lib/wallet/solana");
  const cmd = process.argv[2] || "info";
  if (cmd === "create") {
    const addr = w.createWallet();
    console.log(`Created Clippy's wallet on ${w.NETWORK}.\nAddress: ${addr}\nPrivate key saved to ${w.KEY_FILE} (owner-only). Back it up somewhere safe and never share it.`);
    return;
  }
  if (!w.hasWallet()) return console.log("No wallet yet – run: npm run wallet -- create");
  const addr = w.walletAddress()!;
  if (cmd === "airdrop") {
    if (w.NETWORK !== "devnet") return console.log("Airdrops only exist on devnet.");
    const { PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
    const sig = await w.connection().requestAirdrop(new PublicKey(addr), LAMPORTS_PER_SOL);
    await w.connection().confirmTransaction(sig, "confirmed");
    console.log("Airdropped 1 devnet SOL:", w.explorer(sig));
  }
  const b = await w.balances();
  console.log(`Network: ${w.NETWORK}\nAddress: ${addr}\nSOL:  ${b.sol}\nUSDC: ${b.usdc}\nExplorer: ${w.explorer(addr, "account")}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
