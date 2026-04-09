import { useMyConnectedAccounts } from '@/settings/accounts/hooks/useMyConnectedAccounts';
import { useMemo } from 'react';

export const useConnectedAccountHandleMap = () => {
  const { accounts } = useMyConnectedAccounts();

  return useMemo(() => {
    const map = new Map<string, string>();

    for (const account of accounts) {
      map.set(account.id, account.handle);
    }

    return map;
  }, [accounts]);
};
