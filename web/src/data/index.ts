// All required public endpoints select live wallet/chain/key routes. Partial config keeps the labelled mock.
import { liveConfig } from '../config.ts';
import { createLiveData } from './live.ts';
import { createMockData } from './mock.ts';

const settings = liveConfig();
export const data = settings ? createLiveData(settings) : createMockData();
export { DataError } from './errors.ts';
export type * from './types.ts';

export const walletOptions = () => data.walletOptions();
export const connectWallet = (id: string) => data.connectWallet(id);
export const restoreSession = () => data.restoreSession();
export const disconnect = () => data.disconnect();
export const catalogue = (session?: import('./types.ts').Session) => data.catalogue(session);
