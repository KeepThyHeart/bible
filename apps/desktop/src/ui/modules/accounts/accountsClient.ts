/** Renderer client for the accounts module running in the main process (module IPC namespace `accounts`). */
import type { AccountsApi, AccountsEvents } from '../../../../electron/modules/accounts/types';
import { createModuleClient } from '../../services/moduleClient';

export const accountsClient = createModuleClient<AccountsApi, AccountsEvents>('accounts');
