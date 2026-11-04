import { useCallback, useEffect, useState } from 'react';
import { MockRibbon, Header, type Tab, TABS } from './components/Shell.tsx';
import { data, type Address, type IssuedKey, type Overview, type Session } from './data/index.ts';
import { Account } from './screens/Account.tsx';
import { Bridge } from './screens/Bridge.tsx';
import { Connect } from './screens/Connect.tsx';
import { Keys } from './screens/Keys.tsx';
import { TryApi } from './screens/TryApi.tsx';

const tabFromHash = (): Tab => {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? (id as Tab) : 'account';
};

export function App() {
  const [address, setAddress] = useState<Address | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: Tab) => {
    window.location.hash = next;
    window.scrollTo({ top: 0 });
  }, []);

  const refresh = useCallback(async () => {
    if (address) setOverview(await data.overview(address));
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      {data.isMock && <MockRibbon />}
      <Header address={address} tab={tab} onTab={go} />
      <main id="main" className="page">
        {!address ? (
          <Connect onConnected={setAddress} />
        ) : !overview ? (
          <p className="loading">Reading your vault and credits…</p>
        ) : tab === 'account' ? (
          <Account address={address} overview={overview} onChanged={refresh} onBridge={() => go('bridge')} />
        ) : tab === 'keys' ? (
          <Keys
            address={address}
            overview={overview}
            session={session}
            issued={issued}
            onSession={setSession}
            onIssued={setIssued}
            onChanged={refresh}
            onTry={() => go('try')}
          />
        ) : tab === 'try' ? (
          <TryApi apiKey={issued?.key ?? null} onChanged={refresh} onKeys={() => go('keys')} />
        ) : (
          <Bridge address={address} onDeposit={() => go('account')} />
        )}
      </main>
      <footer className="footer">
        <span>InferNear · built at NEAR HACKATHON</span>
        <span>Private inference on NEAR AI TEE models · credits from yield, never from principal</span>
      </footer>
    </>
  );
}
