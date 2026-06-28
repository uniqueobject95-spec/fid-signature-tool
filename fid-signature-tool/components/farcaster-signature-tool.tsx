'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  createWalletClient,
  createPublicClient,
  custom,
  parseAbi,
  http,
  type Address,
  type Hash,
  decodeAbiParameters,
} from 'viem';
import { optimism } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { Copy, Wallet, Check, AlertCircle, ExternalLink, ArrowRight } from 'lucide-react';

const ID_REGISTRY_ADDRESS = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b' as const;

const ID_REGISTRY_ABI = parseAbi([
  'function nonces(address user) public view returns (uint256)',
  'function transferAndChangeRecovery(address to, address recovery, uint256 deadline, bytes calldata sig) public',
  'function idOf(address addr) public view returns (uint256)',
]);

// Helper to decode signature if it's ABI-encoded as dynamic bytes
// Some wallets (like Base App) return signatures ABI-encoded, which need to be decoded
const decodeSignatureIfNeeded = (sig: string): string => {
  try {
    // Check if signature looks ABI-encoded (starts with 0x followed by 64 hex chars which is the offset 0x20)
    if (sig.startsWith('0x0000000000000000000000000000000000000000000000000000000000000020')) {
      console.log('[v0] Detected ABI-encoded signature, decoding...');
      // Decode as dynamic bytes
      const decoded = decodeAbiParameters(
        [{ type: 'bytes' }],
        sig as `0x${string}`
      );
      const rawSig = decoded[0];
      console.log('[v0] Decoded signature:', rawSig);
      return rawSig as string;
    }
  } catch (e) {
    console.log('[v0] Could not decode signature, using as-is:', e);
  }
  return sig;
};

interface TransferData {
  recipientAddress: Address;
  recipientNonce: number;
  currentFid: number;
  recoveryAddress: Address;
  deadline: number;
  signature: string;
}

export function FarcasterSignatureTool() {
  // FID Owner (Step 1: Connect)
  const [fidOwnerAddress, setFidOwnerAddress] = useState<Address | null>(null);
  const [fidOwnerConnected, setFidOwnerConnected] = useState(false);
  const [currentFid, setCurrentFid] = useState<number | null>(null);

  // Transfer Details
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recoveryAddress, setRecoveryAddress] = useState('');
  const [usePrivateKey, setUsePrivateKey] = useState(false);
  const [recipientPrivateKey, setRecipientPrivateKey] = useState('');
  const [recipientConnected, setRecipientConnected] = useState(false);
  const [recipientConnectedAddress, setRecipientConnectedAddress] = useState<Address | null>(null);

  // Signature Generation
  const [transferData, setTransferData] = useState<TransferData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'pending' | 'confirmed' | 'failed' | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  
  // Step 2 execution options
  const [executionMethod, setExecutionMethod] = useState<'wallet' | 'privatekey'>('wallet');
  const [fidOwnerPrivateKey, setFidOwnerPrivateKey] = useState('');
  const [recipientSignedWithPrivateKey, setRecipientSignedWithPrivateKey] = useState(false);
  const [fidOwnerLoginMethod, setFidOwnerLoginMethod] = useState<'wallet' | 'privatekey'>('wallet');
  const [fidOwnerPrivateKeyInput, setFidOwnerPrivateKeyInput] = useState('');

  const connectFidOwner = async () => {
    setError(null);
    setIsLoading(true);

    try {
      if (!window.ethereum) {
        throw new Error('MetaMask or compatible wallet not found');
      }

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      const userAddress = accounts[0] as Address;
      setFidOwnerAddress(userAddress);
      setFidOwnerConnected(true);

      // Fetch FID for this address. The Farcaster IdRegistry lives on Optimism,
      // so always read from an Optimism RPC instead of routing through the
      // wallet's currently selected chain (which may be Base, etc.).
      const publicClient = createPublicClient({
        chain: optimism,
        transport: http(),
      });

      const fid = await publicClient.readContract({
        address: ID_REGISTRY_ADDRESS,
        abi: ID_REGISTRY_ABI,
        functionName: 'idOf',
        args: [userAddress],
      });

      if (Number(fid) > 0) {
        setCurrentFid(Number(fid));
      } else {
        setError(
          'No Farcaster FID is registered to this address on Optimism. Make sure you connected the wallet that owns the FID.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      setFidOwnerConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loginFidOwnerWithPrivateKey = async () => {
    setError(null);
    setIsLoading(true);

    try {
      if (!fidOwnerPrivateKeyInput) {
        throw new Error('Please enter FID owner private key');
      }

      let pkeyStr = fidOwnerPrivateKeyInput.trim();
      if (!pkeyStr.startsWith('0x')) {
        pkeyStr = '0x' + pkeyStr;
      }

      const account = privateKeyToAccount(pkeyStr as `0x${string}`);
      setFidOwnerAddress(account.address);
      setFidOwnerConnected(true);

      // Fetch FID for this address using an Optimism public RPC
      try {
        const client = createPublicClient({
          chain: optimism,
          transport: http(),
        });

        console.log('[v0] Fetching FID for address:', account.address);
        
        const fid = await client.readContract({
          address: ID_REGISTRY_ADDRESS,
          abi: ID_REGISTRY_ABI,
          functionName: 'idOf',
          args: [account.address],
        });

        console.log('[v0] FID response:', fid);

        if (Number(fid) > 0) {
          setCurrentFid(Number(fid));
          console.log('[v0] Set FID:', Number(fid));
        } else {
          console.log('[v0] No FID found for address (returned 0)');
        }
      } catch (contractErr) {
        console.error('[v0] Contract call error:', contractErr);
        // Don't fail login if FID fetch fails, user can still proceed
        console.log('[v0] Warning: Could not fetch FID, but login proceeds');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login with private key');
      setFidOwnerConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectFidOwner = () => {
    setFidOwnerAddress(null);
    setFidOwnerConnected(false);
    setCurrentFid(null);
    setTransferData(null);
    setError(null);
    setTxStatus(null);
    setTxHash(null);
  };

  const connectRecipientWallet = async () => {
    setError(null);
    setIsLoading(true);

    try {
      if (!window.ethereum) {
        throw new Error('MetaMask or compatible wallet not found');
      }

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      const walletAddress = accounts[0] as Address;
      setRecipientConnectedAddress(walletAddress);
      setRecipientConnected(true);
      setUsePrivateKey(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      setRecipientConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectRecipientWallet = () => {
    setRecipientConnected(false);
    setRecipientConnectedAddress(null);
  };

  const generateSignature = async () => {
    if (!recipientAddress || !recoveryAddress) {
      setError('Please fill in recipient and recovery addresses');
      return;
    }

    if (!usePrivateKey && !recipientConnected) {
      setError('Please connect wallet or select private key option');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      let recipientAddr: Address;
      let nonce: number;

      if (usePrivateKey) {
        // Sign with private key
        if (!recipientPrivateKey) {
          throw new Error('Please enter recipient private key');
        }

        const account = privateKeyToAccount(
          (recipientPrivateKey.startsWith('0x') ? recipientPrivateKey : '0x' + recipientPrivateKey) as `0x${string}`
        );
        recipientAddr = account.address;

        // Fetch nonce for this address from an Optimism public RPC
        const client = createPublicClient({
          chain: optimism,
          transport: http(),
        });

        const nonceResult = await client.readContract({
          address: ID_REGISTRY_ADDRESS,
          abi: ID_REGISTRY_ABI,
          functionName: 'nonces',
          args: [recipientAddr],
        });

        nonce = Number(nonceResult);

        // Sign the message
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        const signature = await account.signTypedData({
          domain: {
            name: 'Farcaster IdRegistry',
            version: '1',
            chainId: 10,
            verifyingContract: ID_REGISTRY_ADDRESS,
          },
          types: {
            TransferAndChangeRecovery: [
              { name: 'fid', type: 'uint256' },
              { name: 'to', type: 'address' },
              { name: 'recovery', type: 'address' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
          },
          primaryType: 'TransferAndChangeRecovery',
          message: {
            fid: BigInt(currentFid!),
            to: recipientAddr,
            recovery: recoveryAddress as Address,
            nonce: BigInt(nonce),
            deadline: BigInt(deadline),
          },
        });

        setTransferData({
          recipientAddress: recipientAddr,
          recipientNonce: nonce,
          currentFid: currentFid!,
          recoveryAddress: recoveryAddress as Address,
          deadline,
          signature,
        });
        setRecipientSignedWithPrivateKey(true);
      } else {
        // Sign with connected wallet
        if (!recipientConnected || !recipientConnectedAddress) {
          throw new Error('Wallet not connected');
        }

        recipientAddr = recipientConnectedAddress;

        // Fetch nonce for this address using public RPC
        try {
          const publicClient = createPublicClient({
            chain: optimism,
            transport: http(),
          });

          console.log('[v0] Fetching nonce for recipient:', recipientAddr);

          const nonceResult = await publicClient.readContract({
            address: ID_REGISTRY_ADDRESS,
            abi: ID_REGISTRY_ABI,
            functionName: 'nonces',
            args: [recipientAddr],
          });

          nonce = Number(nonceResult);
          console.log('[v0] Nonce fetched:', nonce);
        } catch (nonceErr) {
          console.error('[v0] Error fetching nonce:', nonceErr);
          throw new Error('Failed to fetch nonce: ' + (nonceErr instanceof Error ? nonceErr.message : 'Unknown error'));
        }

        // Sign the message using connected wallet
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        const signature = await window.ethereum!.request({
          method: 'eth_signTypedData_v4',
          params: [
            recipientAddr,
            JSON.stringify({
              domain: {
                name: 'Farcaster IdRegistry',
                version: '1',
                chainId: 10,
                verifyingContract: ID_REGISTRY_ADDRESS,
              },
              types: {
                TransferAndChangeRecovery: [
                  { name: 'fid', type: 'uint256' },
                  { name: 'to', type: 'address' },
                  { name: 'recovery', type: 'address' },
                  { name: 'nonce', type: 'uint256' },
                  { name: 'deadline', type: 'uint256' },
                ],
              },
              primaryType: 'TransferAndChangeRecovery',
              message: {
                fid: currentFid!.toString(),
                to: recipientAddr,
                recovery: recoveryAddress as Address,
                nonce: nonce.toString(),
                deadline: deadline.toString(),
              },
            }),
          ],
        });

        setTransferData({
          recipientAddress: recipientAddr,
          recipientNonce: nonce,
          currentFid: currentFid!,
          recoveryAddress: recoveryAddress as Address,
          deadline,
          signature,
        });
        setRecipientSignedWithPrivateKey(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate signature');
    } finally {
      setIsLoading(false);
    }
  };

  const executeTransfer = async () => {
    if (!transferData) {
      setError('Signature generation required first');
      return;
    }

    if (executionMethod === 'wallet' && !fidOwnerAddress) {
      setError('Please connect wallet to execute');
      return;
    }

    if (executionMethod === 'privatekey' && !fidOwnerPrivateKey) {
      setError('Please enter FID owner private key');
      return;
    }

    setError(null);
    setIsLoading(true);
    setTxStatus(null);
    setTxHash(null);

    try {
      let account: Address;
      let client;

      if (executionMethod === 'privatekey') {
        // Execute with private key
        const pkeyStr = fidOwnerPrivateKey.startsWith('0x') ? fidOwnerPrivateKey : '0x' + fidOwnerPrivateKey;
        const pkeyAccount = privateKeyToAccount(pkeyStr as `0x${string}`);
        account = pkeyAccount.address;

        client = createWalletClient({
          chain: optimism,
          account: pkeyAccount,
          transport: http(),
        });
      } else {
        // Execute with connected wallet
        account = fidOwnerAddress!;

        // Ensure the wallet is on Optimism (the IdRegistry lives on OP Mainnet).
        // Wallets like Base App / Toshi often default to Base (8453) and may
        // resolve switch requests asynchronously, so we drive the switch on the
        // raw provider and then poll until it actually reports Optimism.
        const provider = window.ethereum!;
        const optimismHex = `0x${optimism.id.toString(16)}`; // 0xa

        const readChainId = async () => {
          const hex = (await provider.request({ method: 'eth_chainId' })) as string;
          return Number.parseInt(hex, 16);
        };

        let activeChainId = await readChainId();
        if (activeChainId !== optimism.id) {
          try {
            await provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: optimismHex }],
            });
          } catch (switchErr: any) {
            // 4902 = chain not added to the wallet yet; add it then switch.
            if (switchErr?.code === 4902 || switchErr?.cause?.code === 4902) {
              await provider.request({
                method: 'wallet_addEthereumChain',
                params: [
                  {
                    chainId: optimismHex,
                    chainName: 'OP Mainnet',
                    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                    rpcUrls: ['https://mainnet.optimism.io'],
                    blockExplorerUrls: ['https://optimistic.etherscan.io'],
                  },
                ],
              });
              await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: optimismHex }],
              });
            } else {
              throw switchErr;
            }
          }

          // Poll until the provider actually reports Optimism (up to ~5s).
          for (let i = 0; i < 10 && activeChainId !== optimism.id; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            activeChainId = await readChainId();
          }

          if (activeChainId !== optimism.id) {
            throw new Error(
              'Please switch your wallet network to OP Mainnet (Optimism) and try again. Some in-app wallets (Base App / Toshi) require switching the network manually.'
            );
          }
        }

        // Re-request the active account. Switching networks can cause some
        // in-app wallets (Base App / Toshi) to re-scope authorization, which
        // otherwise surfaces as "method/account not authorized" (4100) on send.
        const authorized = (await provider.request({
          method: 'eth_requestAccounts',
        })) as string[];

        const live = authorized?.find(
          (a) => a.toLowerCase() === account.toLowerCase()
        );

        if (!live) {
          throw new Error(
            `Your wallet's active account does not match the FID owner address (${account}). In Base App / Toshi, switch to the account that owns this FID and try again.`
          );
        }

        // Use the wallet's checksummed authorized account as the sender.
        account = live as Address;

        client = createWalletClient({
          chain: optimism,
          transport: custom(provider),
          account,
        });
      }

      // Decode signature if it's ABI-encoded (some wallets like Base App encode it)
      const decodedSignature = decodeSignatureIfNeeded(transferData.signature);

      console.log('[v0] Executing transferAndChangeRecovery with:', {
        to: transferData.recipientAddress,
        recovery: transferData.recoveryAddress,
        deadline: transferData.deadline,
        fid: transferData.currentFid,
        nonce: transferData.recipientNonce,
        signature: decodedSignature,
        executionMethod,
        executor: account,
      });

      const hash = await client.writeContract({
        address: ID_REGISTRY_ADDRESS,
        abi: ID_REGISTRY_ABI,
        functionName: 'transferAndChangeRecovery',
        args: [
          transferData.recipientAddress,
          transferData.recoveryAddress,
          BigInt(transferData.deadline),
          decodedSignature as `0x${string}`,
        ],
      });

      setTxHash(hash);
      setTxStatus('pending');

      // Wait for confirmation over an Optimism HTTP RPC. This must NOT depend on
      // window.ethereum, otherwise the private-key path (which has no injected
      // wallet) throws "e.transport is not a function".
      const confirmClient = createPublicClient({
        chain: optimism,
        transport: http(),
      });

      const receipt = await confirmClient.waitForTransactionReceipt({ hash });
      setTxStatus(receipt.status === 'success' ? 'confirmed' : 'failed');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      setError(errorMessage);
      setTxStatus('failed');
      console.error('[v0] Transaction error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded bg-green-500 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Farcaster FID Transfer</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Transfer your Farcaster FID and set a new recovery address with a single transaction
          </p>
        </div>

        {/* Main Layout */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Setup */}
          <div className="space-y-6">
            {/* FID Owner Connection */}
            <Card className="p-6 border-border bg-card">
              <h2 className="text-lg font-semibold mb-4 text-green-500 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-green-500 text-black flex items-center justify-center text-xs font-bold">1</span>
                Connect FID Owner Wallet
              </h2>

              {fidOwnerConnected && fidOwnerAddress ? (
                <div className="space-y-3">
                  <div className="p-3 rounded bg-green-500/10 border border-green-500/30">
                    <p className="text-xs text-muted-foreground mb-1">Address</p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm text-green-500 truncate">{fidOwnerAddress}</p>
                      <button
                        onClick={() => copyToClipboard(fidOwnerAddress, 'owner')}
                        className="text-muted-foreground hover:text-green-500"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {currentFid && (
                    <div className="p-3 rounded bg-secondary/50">
                      <p className="text-xs text-muted-foreground mb-1">Your FID</p>
                      <p className="font-mono text-lg text-green-500 font-bold">{currentFid}</p>
                    </div>
                  )}
                  <Button
                    onClick={disconnectFidOwner}
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-muted-foreground block">Login Method</label>
                    
                    {/* Wallet Connection Option */}
                    <div 
                      className="p-3 rounded border border-border/30 bg-secondary/20 cursor-pointer hover:border-green-500/50 transition"
                      onClick={() => setFidOwnerLoginMethod('wallet')}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="loginMethod"
                          checked={fidOwnerLoginMethod === 'wallet'}
                          onChange={() => setFidOwnerLoginMethod('wallet')}
                          className="cursor-pointer"
                        />
                        <div>
                          <label className="text-sm font-medium cursor-pointer">Connect Wallet</label>
                          <p className="text-xs text-muted-foreground">MetaMask, Base, or injected wallet</p>
                        </div>
                      </div>
                    </div>

                    {/* Private Key Option */}
                    <div 
                      className="p-3 rounded border border-border/30 bg-secondary/20 cursor-pointer hover:border-green-500/50 transition"
                      onClick={() => setFidOwnerLoginMethod('privatekey')}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="loginMethod"
                          checked={fidOwnerLoginMethod === 'privatekey'}
                          onChange={() => setFidOwnerLoginMethod('privatekey')}
                          className="cursor-pointer"
                        />
                        <div>
                          <label className="text-sm font-medium cursor-pointer">Private Key Login</label>
                          <p className="text-xs text-muted-foreground">Login with FID owner private key</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Private Key Input */}
                  {fidOwnerLoginMethod === 'privatekey' && (
                    <div>
                      <Input
                        type="text"
                        placeholder="FID owner private key (with or without 0x)"
                        value={fidOwnerPrivateKeyInput}
                        onChange={(e) => setFidOwnerPrivateKeyInput(e.target.value)}
                        disabled={isLoading}
                        autoComplete="off"
                        spellCheck="false"
                        className="font-mono text-xs bg-secondary/50 border-border"
                      />
                      <p className="text-xs text-muted-foreground mt-2">You can paste your private key here. It is only used locally in your browser.</p>
                    </div>
                  )}

                  {/* Login/Connect Button */}
                  <Button
                    onClick={fidOwnerLoginMethod === 'wallet' ? connectFidOwner : loginFidOwnerWithPrivateKey}
                    disabled={isLoading || (fidOwnerLoginMethod === 'privatekey' && !fidOwnerPrivateKeyInput)}
                    className="w-full bg-green-500 text-black hover:bg-green-400 font-semibold"
                  >
                    {isLoading ? 'Loading...' : fidOwnerLoginMethod === 'wallet' ? 'Connect Wallet' : 'Login with Private Key'}
                  </Button>
                </div>
              )}
            </Card>

            {/* Transfer Details */}
            {fidOwnerConnected && (
              <Card className="p-6 border-border bg-card">
                <h2 className="text-lg font-semibold mb-4 text-green-500 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-green-500 text-black flex items-center justify-center text-xs font-bold">2</span>
                  Transfer Details
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Recipient Address (who will receive FID)
                    </label>
                    <Input
                      placeholder="0x..."
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                      disabled={isLoading || !!transferData}
                      className="font-mono text-sm bg-secondary/50 border-border"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      New Recovery Address
                    </label>
                    <Input
                      placeholder="0x..."
                      value={recoveryAddress}
                      onChange={(e) => setRecoveryAddress(e.target.value)}
                      disabled={isLoading || !!transferData}
                      className="font-mono text-sm bg-secondary/50 border-border"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-muted-foreground block">Signing Method</label>

                    {/* Connect Wallet Option */}
                    <div className="p-3 rounded border border-border/30 bg-secondary/20 cursor-pointer hover:border-green-500/50 transition" onClick={() => {
                      setUsePrivateKey(false);
                      if (!recipientConnected) connectRecipientWallet();
                    }}>
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="recipientSigningMethod"
                          checked={!usePrivateKey}
                          onChange={() => {
                            setUsePrivateKey(false);
                            if (!recipientConnected) connectRecipientWallet();
                          }}
                          disabled={isLoading || !!transferData}
                          className="cursor-pointer"
                        />
                        <div className="flex-1">
                          <label className="text-sm font-medium cursor-pointer">Connect Wallet</label>
                          <p className="text-xs text-muted-foreground">MetaMask, Base, or injected wallet</p>
                        </div>
                      </div>
                      {!usePrivateKey && recipientConnected && recipientConnectedAddress && (
                        <div className="mt-2 ml-7 text-xs text-green-500">✓ {recipientConnectedAddress.slice(0, 10)}...{recipientConnectedAddress.slice(-8)}</div>
                      )}
                    </div>

                    {/* Private Key Option */}
                    <div className="p-3 rounded border border-border/30 bg-secondary/20 cursor-pointer hover:border-green-500/50 transition" onClick={() => setUsePrivateKey(true)}>
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="recipientSigningMethod"
                          checked={usePrivateKey}
                          onChange={() => setUsePrivateKey(true)}
                          disabled={isLoading || !!transferData}
                          className="cursor-pointer"
                        />
                        <div>
                          <label className="text-sm font-medium cursor-pointer">Private Key</label>
                          <p className="text-xs text-muted-foreground">Sign with recipient private key</p>
                        </div>
                      </div>
                    </div>

                    {/* Private Key Input */}
                    {usePrivateKey && (
                      <Input
                        type="text"
                        placeholder="Recipient private key (with or without 0x)"
                        value={recipientPrivateKey}
                        onChange={(e) => setRecipientPrivateKey(e.target.value)}
                        disabled={isLoading || !!transferData}
                        autoComplete="off"
                        spellCheck="false"
                        className="font-mono text-xs bg-secondary/50 border-border"
                      />
                    )}

                    {/* Disconnect Button */}
                    {!usePrivateKey && recipientConnected && (
                      <Button
                        onClick={disconnectRecipientWallet}
                        disabled={isLoading || !!transferData}
                        className="w-full bg-red-600 hover:bg-red-700 text-white text-xs py-1"
                      >
                        Disconnect Wallet
                      </Button>
                    )}
                  </div>

                  <Button
                    onClick={generateSignature}
                    disabled={isLoading || !recipientAddress || !recoveryAddress || (usePrivateKey && !recipientPrivateKey) || (!usePrivateKey && !recipientConnected) || !!transferData}
                    className="w-full bg-green-500 text-black hover:bg-green-400 font-semibold"
                  >
                    {isLoading ? 'Generating...' : 'Generate Signature'}
                  </Button>
                </div>
              </Card>
            )}
          </div>

          {/* Right: Signature & Execution */}
          <div className="space-y-6">
            {error && (
              <Card className="p-4 border-red-500/30 bg-red-500/10">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              </Card>
            )}

            {transferData && (
              <>
                {/* Signature Details */}
                <Card className="p-6 border-green-500/30 bg-card">
                  <h2 className="text-lg font-semibold mb-4 text-green-500 flex items-center gap-2">
                    <Check className="w-5 h-5" />
                    Signature Generated
                  </h2>

                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Recipient Address</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs text-green-500 truncate">{transferData.recipientAddress}</p>
                        <button
                          onClick={() => copyToClipboard(transferData.recipientAddress, 'recipient')}
                          className="text-muted-foreground hover:text-green-500"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Recovery Address</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs text-green-500 truncate">{transferData.recoveryAddress}</p>
                        <button
                          onClick={() => copyToClipboard(transferData.recoveryAddress, 'recovery')}
                          className="text-muted-foreground hover:text-green-500"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">FID</p>
                        <p className="font-mono text-sm text-green-500 font-bold">{transferData.currentFid}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Nonce</p>
                        <p className="font-mono text-sm text-green-500 font-bold">{transferData.recipientNonce}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Deadline</p>
                        <p className="font-mono text-xs text-green-500">{transferData.deadline}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Expiry</p>
                        <p className="text-xs text-green-500">{new Date(transferData.deadline * 1000).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Signature */}
                <Card className="p-6 border-border bg-card">
                  <h3 className="font-semibold text-green-500 mb-3">EIP-712 Signature</h3>
                  <div className="p-3 rounded bg-secondary/50 border border-border overflow-auto max-h-32">
                    <p className="font-mono text-xs text-muted-foreground break-all">{transferData.signature}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(transferData.signature, 'sig')}
                    className="mt-2 w-full px-3 py-2 rounded text-sm border border-border hover:border-green-500 transition"
                  >
                    {copied === 'sig' ? '✓ Copied' : 'Copy Signature'}
                  </button>
                </Card>

                {/* Execution Method Selection */}
                <Card className="p-6 border-border bg-card">
                  <h3 className="font-semibold text-green-500 mb-4 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500 text-black flex items-center justify-center text-xs font-bold">3</span>
                    Execute Transfer
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-muted-foreground block">Execution Method</label>
                      
                      {/* Wallet Option */}
                      <div className="p-3 rounded border border-border/30 bg-secondary/20 cursor-pointer hover:border-green-500/50 transition" onClick={() => setExecutionMethod('wallet')}>
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            id="walletExec"
                            name="executionMethod"
                            checked={executionMethod === 'wallet'}
                            onChange={() => setExecutionMethod('wallet')}
                            className="cursor-pointer"
                          />
                          <div className="flex-1">
                            <label htmlFor="walletExec" className="text-sm font-medium cursor-pointer">
                              Connect Wallet
                            </label>
                            <p className="text-xs text-muted-foreground">Use your connected wallet to execute</p>
                          </div>
                        </div>
                        {executionMethod === 'wallet' && fidOwnerConnected && (
                          <div className="mt-2 pl-7 text-xs text-green-500">✓ {fidOwnerAddress}</div>
                        )}
                      </div>

                      {/* Private Key Option */}
                      <div className="p-3 rounded border border-border/30 bg-secondary/20 cursor-pointer hover:border-green-500/50 transition" onClick={() => setExecutionMethod('privatekey')}>
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            id="privateKeyExec"
                            name="executionMethod"
                            checked={executionMethod === 'privatekey'}
                            onChange={() => setExecutionMethod('privatekey')}
                            className="cursor-pointer"
                          />
                          <div className="flex-1">
                            <label htmlFor="privateKeyExec" className="text-sm font-medium cursor-pointer">
                              FID Owner Private Key
                            </label>
                            <p className="text-xs text-muted-foreground">
                              {recipientSignedWithPrivateKey ? 'Uses same method as signing' : 'Sign with private key'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {executionMethod === 'privatekey' && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground mb-2 block">
                          FID Owner Private Key
                        </label>
                        <Input
                          type="password"
                          placeholder="Private key (with or without 0x)"
                          value={fidOwnerPrivateKey}
                          onChange={(e) => setFidOwnerPrivateKey(e.target.value)}
                          disabled={isLoading || txStatus === 'confirmed'}
                          className="font-mono text-xs bg-secondary/50 border-border"
                        />
                      </div>
                    )}
                  </div>
                </Card>

                {/* Execute Button */}
                <Button
                  onClick={executeTransfer}
                  disabled={isLoading || txStatus === 'confirmed' || (executionMethod === 'wallet' && !fidOwnerConnected) || (executionMethod === 'privatekey' && !fidOwnerPrivateKey)}
                  className="w-full bg-green-500 text-black hover:bg-green-400 font-semibold py-6 text-lg flex items-center justify-center gap-2"
                >
                  {isLoading ? 'Executing...' : txStatus === 'confirmed' ? '✓ Transfer Complete' : 'Execute Transfer'}
                  {!isLoading && txStatus !== 'confirmed' && <ArrowRight className="w-5 h-5" />}
                </Button>

                {/* Transaction Status */}
                {txHash && (
                  <Card className="p-6 border-border bg-card">
                    <h3 className="font-semibold text-green-500 mb-3">Transaction</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Hash</p>
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs text-green-500 truncate">{txHash}</p>
                          <button
                            onClick={() => copyToClipboard(txHash, 'tx')}
                            className="text-muted-foreground hover:text-green-500"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Status</p>
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              txStatus === 'confirmed'
                                ? 'bg-green-500'
                                : txStatus === 'pending'
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                          />
                          <p className="text-sm capitalize text-green-500 font-semibold">{txStatus}</p>
                        </div>
                      </div>
                      <a
                        href={`https://optimistic.etherscan.io/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 px-3 py-2 rounded text-sm border border-green-500/30 hover:border-green-500 text-green-500 transition"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View on Etherscan
                      </a>
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
