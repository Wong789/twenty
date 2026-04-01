import { useCallback } from 'react';
import { isDefined } from 'twenty-shared/utils';

import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { renewToken } from '@/auth/services/AuthService';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

export const useAuthenticatedFetch = () => {
  const setTokenPair = useSetAtomState(tokenPairState);

  const retryFetchWithRenewedToken = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const tokenPair = getTokenPair();

      if (!isDefined(tokenPair)) {
        return null;
      }

      try {
        const renewedTokens = await renewToken(
          `${REACT_APP_SERVER_BASE_URL}/metadata`,
          tokenPair,
        );

        if (!isDefined(renewedTokens)) {
          setTokenPair(null);

          return null;
        }

        const renewedAccessToken =
          renewedTokens.accessOrWorkspaceAgnosticToken?.token;

        if (!isDefined(renewedAccessToken)) {
          setTokenPair(null);

          return null;
        }

        setTokenPair(renewedTokens);

        const updatedHeaders = new Headers(init?.headers ?? {});

        updatedHeaders.set('Authorization', `Bearer ${renewedAccessToken}`);

        return fetch(input, {
          ...init,
          headers: updatedHeaders,
        });
      } catch {
        setTokenPair(null);

        return null;
      }
    },
    [setTokenPair],
  );

  const authenticatedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);

      if (response.status === 401) {
        const retriedResponse = await retryFetchWithRenewedToken(input, init);

        return retriedResponse ?? response;
      }

      return response;
    },
    [retryFetchWithRenewedToken],
  );

  return { authenticatedFetch };
};
