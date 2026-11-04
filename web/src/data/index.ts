// The one place the UI gets its data from. Wiring Base, NEAR and the relay
// means adding an implementation of DashboardData and exporting it here.
import { createMockData } from './mock.ts';

export const data = createMockData();
export { DataError } from './errors.ts';
export type * from './types.ts';
