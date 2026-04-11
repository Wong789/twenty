import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useQuery } from '@apollo/client/react';
import { t } from '@lingui/core/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath, isDefined } from 'twenty-shared/utils';

import { AI_ADMIN_PATH } from '@/settings/admin-panel/ai/constants/AiAdminPath';
import { SettingsAdminWorkspaceContent } from '@/settings/admin-panel/components/SettingsAdminWorkspaceContent';
import { GET_ADMIN_WORKSPACE_CHAT_THREADS } from '@/settings/admin-panel/graphql/queries/getAdminWorkspaceChatThreads';
import { WORKSPACE_LOOKUP_ADMIN_PANEL } from '@/settings/admin-panel/graphql/queries/workspaceLookupAdminPanel';
import { userLookupResultState } from '@/settings/admin-panel/states/userLookupResultState';
import { type AdminChatThread } from '@/settings/admin-panel/types/AdminChatThread';
import { type UserLookup } from '@/settings/admin-panel/types/UserLookup';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsSkeletonLoader } from '@/settings/components/SettingsSkeletonLoader';
import { Table } from '@/ui/layout/table/components/Table';
import { TableCell } from '@/ui/layout/table/components/TableCell';
import { TableHeader } from '@/ui/layout/table/components/TableHeader';
import { TableRow } from '@/ui/layout/table/components/TableRow';
import { TabList } from '@/ui/layout/tab-list/components/TabList';
import { activeTabIdComponentState } from '@/ui/layout/tab-list/states/activeTabIdComponentState';
import { SubMenuTopBarContainer } from '@/ui/layout/page/components/SubMenuTopBarContainer';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { useAtomComponentState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentState';
import { Card } from 'twenty-ui/layout';
import { H2Title, IconMessage, IconSettings2 } from 'twenty-ui/display';
import { Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const WORKSPACE_DETAIL_TABS_ID = 'settings-admin-workspace-detail-tabs';

const WORKSPACE_DETAIL_TAB_IDS = {
  INFO: 'info',
  CHATS: 'chats',
};

export const SettingsAdminWorkspaceDetail = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  const [activeTabId] = useAtomComponentState(
    activeTabIdComponentState,
    WORKSPACE_DETAIL_TABS_ID,
  );

  const [, setUserLookupResult] = useAtomState(userLookupResultState);

  const { data: workspaceData, loading: isLoadingWorkspace } = useQuery<{
    workspaceLookupAdminPanel: UserLookup;
  }>(WORKSPACE_LOOKUP_ADMIN_PANEL, {
    variables: { workspaceId },
    skip: !workspaceId,
    onCompleted: (data) => {
      if (isDefined(data?.workspaceLookupAdminPanel)) {
        setUserLookupResult(data.workspaceLookupAdminPanel);
      }
    },
  });

  const workspace =
    workspaceData?.workspaceLookupAdminPanel?.workspaces?.[0];

  const effectiveTabId = activeTabId || WORKSPACE_DETAIL_TAB_IDS.INFO;

  const { data: threadsData, loading: isLoadingThreads } = useQuery<{
    getAdminWorkspaceChatThreads: AdminChatThread[];
  }>(GET_ADMIN_WORKSPACE_CHAT_THREADS, {
    variables: { workspaceId },
    skip:
      !workspaceId ||
      !workspace?.allowImpersonation ||
      effectiveTabId !== WORKSPACE_DETAIL_TAB_IDS.CHATS,
  });

  const threads = threadsData?.getAdminWorkspaceChatThreads ?? [];

  const tabs = useMemo(() => {
    const result = [
      {
        id: WORKSPACE_DETAIL_TAB_IDS.INFO,
        title: t`Info`,
        Icon: IconSettings2,
      },
    ];

    if (workspace?.allowImpersonation) {
      result.push({
        id: WORKSPACE_DETAIL_TAB_IDS.CHATS,
        title: t`Chats`,
        Icon: IconMessage,
      });
    }

    return result;
  }, [workspace?.allowImpersonation]);

  const workspaceName = workspace?.name || workspaceId || '';

  if (isLoadingWorkspace) {
    return <SettingsSkeletonLoader />;
  }

  return (
    <SubMenuTopBarContainer
      links={[
        {
          children: t`Other`,
          href: getSettingsPath(SettingsPath.AdminPanel),
        },
        {
          children: t`Admin Panel`,
          href: getSettingsPath(SettingsPath.AdminPanel),
        },
        {
          children: t`AI`,
          href: AI_ADMIN_PATH,
        },
        {
          children: workspaceName,
        },
      ]}
    >
      <SettingsPageContainer>
        <TabList
          tabs={tabs}
          behaveAsLinks={false}
          componentInstanceId={WORKSPACE_DETAIL_TABS_ID}
        />

        {effectiveTabId === WORKSPACE_DETAIL_TAB_IDS.INFO && workspace && (
          <SettingsAdminWorkspaceContent activeWorkspace={workspace} />
        )}

        {effectiveTabId === WORKSPACE_DETAIL_TAB_IDS.CHATS && (
          <Section>
            <H2Title
              title={t`Chat Sessions`}
              description={t`AI chat threads for this workspace`}
            />
            {threads.length === 0 ? (
              <Card rounded>
                <TableRow gridTemplateColumns="1fr">
                  <TableCell
                    color={themeCssVariables.font.color.tertiary}
                    align="center"
                  >
                    {isLoadingThreads
                      ? t`Loading...`
                      : t`No chat threads found.`}
                  </TableCell>
                </TableRow>
              </Card>
            ) : (
              <Table>
                <TableRow gridTemplateColumns="1fr 120px 120px">
                  <TableHeader>{t`Title`}</TableHeader>
                  <TableHeader align="right">{t`Messages`}</TableHeader>
                  <TableHeader align="right">{t`Updated`}</TableHeader>
                </TableRow>
                {threads.map((thread) => (
                  <TableRow
                    key={thread.id}
                    gridTemplateColumns="1fr 120px 120px"
                    onClick={() =>
                      navigate(
                        getSettingsPath(
                          SettingsPath.AdminPanelWorkspaceChatThread,
                          {
                            workspaceId: workspaceId ?? '',
                            threadId: thread.id,
                          },
                        ),
                      )
                    }
                  >
                    <TableCell color={themeCssVariables.font.color.primary}>
                      {thread.title || t`Untitled`}
                    </TableCell>
                    <TableCell align="right">
                      {thread.conversationSize}
                    </TableCell>
                    <TableCell align="right">
                      {new Date(thread.updatedAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            )}
          </Section>
        )}
      </SettingsPageContainer>
    </SubMenuTopBarContainer>
  );
};
