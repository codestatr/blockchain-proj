"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatEther, getAddress, isAddress, parseEther } from "viem";
import { useAccount, useConnect, useDisconnect, usePublicClient, useReadContract, useReadContracts, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { baseSepolia, hardhatLocal } from "@/lib/chains";
import { contractAddressForChain, wasteRewardAbi } from "@/lib/contract";
import type { User } from "@/lib/auth";

type Deposit = { id: bigint; wasteType: string; weight: bigint; timestamp: bigint; reward: bigint; txHash?: `0x${string}` };

function shortAddress(address?: string) { return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ""; }
function dateLabel(timestamp: bigint) { return new Date(Number(timestamp) * 1000).toLocaleDateString(); }

export default function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const contractAddress = contractAddressForChain(chainId);
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [modalOpen, setModalOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferPending, setTransferPending] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferHash, setTransferHash] = useState<`0x${string}` | null>(null);
  const [wasteType, setWasteType] = useState("Plastic");
  const [binId, setBinId] = useState("BIN-001");
  const [weight, setWeight] = useState("500");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [walletLinking, setWalletLinking] = useState(false);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const supported = chainId === hardhatLocal.id || chainId === baseSepolia.id;
  const isConfigured = isAddress(contractAddress) && contractAddress !== "0x0000000000000000000000000000000000000000";
  const explorerBase = chainId === baseSepolia.id ? baseSepolia.blockExplorers?.default.url : undefined;

  const { data: balance, refetch: refetchBalance } = useReadContract({ address: contractAddress, abi: wasteRewardAbi, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: isConnected && supported && isConfigured } });
  const { data: depositIds, refetch: refetchDepositIds } = useReadContract({ address: contractAddress, abi: wasteRewardAbi, functionName: "getCitizenDepositIds", args: address ? [address] : undefined, query: { enabled: isConnected && supported && isConfigured } });
  const { data: onChainRows } = useReadContracts({
    contracts: (depositIds ?? []).map((id) => ({ address: contractAddress, abi: wasteRewardAbi, functionName: "deposits" as const, args: [id] })),
    query: { enabled: !!depositIds?.length }
  });
  const { data: totalWeight } = useReadContract({ address: contractAddress, abi: wasteRewardAbi, functionName: "totalWeightInGrams", query: { enabled: supported && isConfigured } });
  const totalKg = totalWeight ? (Number(totalWeight) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "0";
  const balanceText = balance !== undefined ? Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0.00";
  async function connectWallet() {
    setError("");
    if (!connectors.length) {
      setError("No wallet connector is available. Install or enable a browser wallet such as MetaMask, then reload this page.");
      return;
    }
    setWalletConnecting(true);
    let timeoutId: number | undefined;
    try {
      const available = await Promise.all(connectors.map(async (candidate) => ({
        connector: candidate,
        provider: await candidate.getProvider().catch(() => undefined)
      })));
      const selected = available.find((item) => item.provider)?.connector;
      if (!selected) throw new Error("No browser wallet was found. Unlock Rabby, MetaMask, or Coinbase Wallet, then reload this page.");

      await Promise.race([
        connectAsync({ connector: selected }),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error("No response came from the wallet. Approve the connection in Rabby, or close the pending wallet prompt and retry.")), 60_000);
        })
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Wallet connection failed.";
      if (/provider not found|not found/i.test(message)) {
        setError("No browser wallet was found. Unlock Rabby, MetaMask, or Coinbase Wallet, then reload this page.");
      } else if (/user rejected|user denied|rejected the request/i.test(message)) {
        setError("The wallet request was cancelled. Approve the connection in your wallet to continue.");
      } else {
        setError(message.length > 240 ? `${message.slice(0, 237)}…` : message);
      }
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      setWalletConnecting(false);
    }
  }

  const switchToChain = async (target: number) => {
    try { await switchChain({ chainId: target }); }
    catch { setError("Could not switch network. Add Localhost (31337) or Base Sepolia (84532) in your wallet."); }
  };

  async function submitDeposit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!address) { setError("Connect a wallet first."); return; }
    if (!chainId || !supported) { setError("Switch your wallet to Base Sepolia before recording a deposit."); return; }
    if (!isConfigured) { setError("The RCT contract is not configured for this network. Deploy it and add its address to the site environment variables."); return; }
    const grams = Number(weight);
    if (!Number.isInteger(grams) || grams < 1 || grams > 100_000) { setError("Enter a whole number from 1 to 100,000 grams."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/deposit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wasteType, weightInGrams: grams, binId: binId.trim(), chainId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Deposit failed.");
      setDeposits((rows) => [{ id: BigInt(result.depositId), wasteType, weight: BigInt(grams), timestamp: BigInt(Math.floor(Date.now() / 1000)), reward: BigInt(grams) * 10n ** 16n, txHash: result.transactionHash }, ...rows]);
      await Promise.all([refetchBalance(), refetchDepositIds()]); setModalOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit deposit."); }
    finally { setSubmitting(false); }
  }

  async function submitTransfer(event: React.FormEvent) {
    event.preventDefault(); setTransferError("");
    if (!address || !user.walletAddress || address.toLowerCase() !== user.walletAddress.toLowerCase()) {
      setTransferError("Connect your verified reward wallet before sending RCT."); return;
    }
    if (!supported) { setTransferError("Switch your wallet to Base Sepolia before sending RCT."); return; }
    if (!isConfigured) { setTransferError("The RCT contract is not configured for this network."); return; }
    if (!isAddress(recipient)) { setTransferError("Enter a valid recipient wallet address."); return; }
    let value: bigint;
    try { value = parseEther(transferAmount); } catch { setTransferError("Enter a valid token amount."); return; }
    if (value <= 0n) { setTransferError("Enter an amount greater than zero."); return; }
    if (balance !== undefined && value > balance) { setTransferError("Your RCT balance is too low for this transfer."); return; }
    setTransferPending(true);
    try {
      const hash = await writeContractAsync({ address: contractAddress, abi: wasteRewardAbi, functionName: "transfer", args: [getAddress(recipient), value] });
      setTransferHash(hash);
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      await refetchBalance(); setTransferOpen(false); setRecipient(""); setTransferAmount("");
    } catch (cause) {
      setTransferError(cause instanceof Error ? cause.message : "The wallet transfer failed.");
    } finally { setTransferPending(false); }
  }

  async function linkWallet() {
    if (!address) return;
    setError(""); setWalletLinking(true);
    try {
      const challengeResponse = await fetch("/api/auth/wallet/challenge", { method: "POST" });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok) throw new Error(challenge.error || "Could not start wallet verification.");
      const signature = await signMessageAsync({ message: challenge.message });
      const response = await fetch("/api/auth/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, message: challenge.message, signature }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not link wallet.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet verification failed."); }
    finally { setWalletLinking(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnect(); router.replace("/login"); router.refresh();
  }

  const history = useMemo(() => {
    const sessionRows = new Map(deposits.map((row) => [row.id.toString(), row]));
    const rows = (onChainRows ?? []).flatMap((entry) => {
      if (entry.status !== "success") return [];
      const value = entry.result as readonly [bigint, `0x${string}`, string, bigint, bigint];
      return [{ id: value[0], wasteType: value[2], weight: value[3], timestamp: value[4], reward: value[3] * 10n ** 16n, txHash: sessionRows.get(value[0].toString())?.txHash }];
    });
    const known = new Set(rows.map((row) => row.id.toString()));
    return [...deposits.filter((row) => !known.has(row.id.toString())), ...rows];
  }, [deposits, onChainRows]);

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">↻</span> Waste System</div>
      {isConnected ? <button className="connect" onClick={() => disconnect()}>{shortAddress(address)} · Disconnect</button> : <button className="connect" disabled={walletConnecting} onClick={connectWallet}>{walletConnecting ? "Approve in wallet…" : "Connect wallet"}</button>}
      <span className="account-name">{user.name}</span><button className="secondary" onClick={logout}>Sign out</button>
    </header>
    <div className="hero"><div><div className="eyebrow">Circular cities start here</div><h1>Waste less.<br/>Earn more.</h1><p className="sub">Your recycling makes a measurable difference.</p></div>
      {isConnected && <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="secondary" onClick={() => switchToChain(hardhatLocal.id)} disabled={switching}>Localhost</button><button className="secondary" onClick={() => switchToChain(baseSepolia.id)} disabled={switching}>Base Sepolia</button></div>}
    </div>
    {!isConfigured && <div className="notice">RCT contract not configured. Deploy it to Base Sepolia and set NEXT_PUBLIC_BASE_SEPOLIA_CONTRACT_ADDRESS in your hosting environment.</div>}
    {isConnected && !supported && <div className="notice">Switch to Localhost or Base Sepolia to use the dashboard. Current network: {chainId ?? "unknown"}.</div>}
    {isConfigured && <div className="contract-strip"><span className="metric-label">RCT contract</span><code>{shortAddress(contractAddress)}</code>{explorerBase && <a href={`${explorerBase}/address/${contractAddress}`} target="_blank" rel="noreferrer">View on BaseScan</a>}<span className="chain-label">{chainId === baseSepolia.id ? "Base Sepolia" : chainId === hardhatLocal.id ? "Hardhat Local" : "Connect a supported wallet"}</span></div>}
    <section className="card wallet-card"><div><div className="metric-label">Verified reward wallet</div><div className="wallet-value">{user.walletAddress ? shortAddress(user.walletAddress) : "No wallet linked"}</div></div>{!user.walletAddress && <button className="connect" onClick={linkWallet} disabled={!isConnected || walletLinking}>{walletLinking ? "Verifying wallet…" : isConnected ? "Sign message to link wallet" : "Connect wallet to link"}</button>}{user.walletAddress && isConnected && user.walletAddress.toLowerCase() !== address?.toLowerCase() && <span className="notice-inline">Connect {shortAddress(user.walletAddress)} to use deposits and view its balance.</span>}</section>
    {error && !modalOpen && <div className="error page-error" role="alert">{error}</div>}
    <section className="grid">
      <article className="card"><div className="metric-label">Your RCT balance</div><div className="metric">{balanceText} <span style={{fontSize:15}}>RCT</span></div><div className="metric-note">10 RCT for every kilogram</div></article>
      <article className="card"><div className="metric-label">Total waste recorded</div><div className="metric">{totalKg} <span style={{fontSize:15}}>kg</span></div><div className="metric-note">On-chain record; weight is user-entered</div></article>
      <article className="card"><div className="metric-label">Your recorded deposits</div><div className="metric">{history.length}</div><div className="metric-note">Loaded from your reward wallet on chain</div></article>
    </section>
    <section className="content">
      <article className="card"><div className="section-head"><h2>Deposit history</h2><span className="muted">Recent activity</span></div>
        <div className="table-wrap"><table><thead><tr><th>Material</th><th>Weight</th><th>Reward</th><th>Date</th><th>Status</th><th>Transaction</th></tr></thead><tbody>
          {history.length ? history.map((row) => <tr key={row.id.toString()}><td>{row.wasteType}</td><td>{(Number(row.weight) / 1000).toFixed(2)} kg</td><td>{formatEther(row.reward)} RCT</td><td>{dateLabel(row.timestamp)}</td><td><span className="pill">Confirmed</span></td><td>{row.txHash ? explorerBase ? <a href={`${explorerBase}/tx/${row.txHash}`} target="_blank" rel="noreferrer">View tx ↗</a> : <code title={row.txHash}>{shortAddress(row.txHash)}</code> : <span className="muted">—</span>}</td></tr>) : <tr><td colSpan={6} className="empty">{isConnected ? "No deposits recorded for this wallet yet." : "Connect your wallet to view your recycling activity."}</td></tr>}
        </tbody></table></div>
      </article>
      <article className="card bin-card"><div className="bin-icon">♻</div><h2>Record a deposit</h2><p className="muted">Enter the collected material and measured weight. Rewards are sent to your verified wallet.</p>
        <button className="connect" onClick={() => { setError(""); setModalOpen(true); }} disabled={!isConnected || !supported || !isConfigured || !user.walletAddress || user.walletAddress.toLowerCase() !== address?.toLowerCase()}>Record a deposit</button>
        <button className="secondary transfer-button" onClick={() => { setTransferError(""); setTransferOpen(true); }} disabled={!isConnected || !supported || !isConfigured || !user.walletAddress || user.walletAddress.toLowerCase() !== address?.toLowerCase()}>Send RCT</button>
        {transferHash && <div className="transfer-receipt">Last transfer: {explorerBase ? <a href={`${explorerBase}/tx/${transferHash}`} target="_blank" rel="noreferrer">View on BaseScan ↗</a> : <code title={transferHash}>{shortAddress(transferHash)}</code>}</div>}
      </article>
    </section>
    <footer className="footer">Waste System · Supporting SDG 11.6 through circular cities</footer>
    {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setModalOpen(false); }}><form className="modal" onSubmit={submitDeposit}><h2>Record a deposit</h2><p className="muted">Rewards are calculated at 10 RCT per kilogram.</p>
      <label className="field">Material<select value={wasteType} onChange={(event) => setWasteType(event.target.value)}><option>Plastic</option><option>Glass</option><option>Metal</option></select></label>
      <label className="field">Collection point ID<input value={binId} onChange={(event) => setBinId(event.target.value)} minLength={1} maxLength={40} required /></label>
      <label className="field">Weight in grams<input type="number" min="1" max="100000" step="1" value={weight} onChange={(event) => setWeight(event.target.value)} required/></label>
      <div className="muted" style={{marginTop:10}}>Estimated reward: {(Number(weight || 0) / 100).toFixed(2)} RCT</div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="modal-actions"><button className="secondary" type="button" disabled={submitting} onClick={() => setModalOpen(false)}>Cancel</button><button className="connect" disabled={submitting}>{submitting ? "Recording…" : "Confirm deposit"}</button></div>
    </form></div>}
    {transferOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !transferPending) setTransferOpen(false); }}><form className="modal" onSubmit={submitTransfer}><h2>Send RCT</h2><p className="muted">Transfer tokens from your verified wallet. Your wallet will ask you to confirm and pay network gas.</p>
      <label className="field">Recipient wallet<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" autoComplete="off" required /></label>
      <label className="field">Amount in RCT<input type="number" min="0.000000000000000001" step="any" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} required /></label>
      {transferError && <div className="error" role="alert">{transferError}</div>}
      <div className="modal-actions"><button className="secondary" type="button" disabled={transferPending} onClick={() => setTransferOpen(false)}>Cancel</button><button className="connect" disabled={transferPending}>{transferPending ? "Waiting for confirmation…" : "Review in wallet"}</button></div>
    </form></div>}
  </main>;
}
