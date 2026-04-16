import { useNavigate, useParams } from 'react-router-dom';

import { useLogicFunctionForm } from '@/logic-functions/hooks/useLogicFunctionForm';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsLogicFunctionLabelContainer } from '@/settings/logic-functions/components/SettingsLogicFunctionLabelContainer';
import { SettingsLogicFunctionSettingsTab } from '@/settings/logic-functions/components/tabs/SettingsLogicFunctionSettingsTab';
import { SettingsLogicFunctionTestTab } from '@/settings/logic-functions/components/tabs/SettingsLogicFunctionTestTab';
import { SettingsLogicFunctionTriggersTab } from '@/settings/logic-functions/components/tabs/SettingsLogicFunctionTriggersTab';
import { SubMenuTopBarContainer } from '@/ui/layout/page/components/SubMenuTopBarContainer';
import { TabList } from '@/ui/layout/tab-list/components/TabList';
import { activeTabIdComponentState } from '@/ui/layout/tab-list/states/activeTabIdComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { t } from '@lingui/core/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath, isDefined } from 'twenty-shared/utils';
import {
  IconBolt,
  IconCode,
  IconPlayerPlay,
  IconSettings,
} from 'twenty-ui/display';
import { useQuery } from '@apollo/client/react';
import { FindOneApplicationByUniversalIdentifierDocument } from '~/generated-metadata/graphql';
import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { SettingsLogicFunctionCodeEditorTab } from '@/settings/logic-functions/components/tabs/SettingsLogicFunctionCodeEditorTab';
import { useExecuteLogicFunction } from '@/logic-functions/hooks/useExecuteLogicFunction';

const LOGIC_FUNCTION_DETAIL_ID = 'logic-function-detail';

export const SettingsLogicFunctionDetail = () => {
  const { logicFunctionId = '', applicationUniversalIdentifier = '' } =
    useParams();

  const navigate = useNavigate();
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);

  const { data: applicationData, loading: applicationLoading } = useQuery(
    FindOneApplicationByUniversalIdentifierDocument,
    {
      variables: { universalIdentifier: applicationUniversalIdentifier },
      skip: !applicationUniversalIdentifier,
    },
  );

  const application = applicationData?.findOneApplication;

  if (!application) {
    return null;
  }

  const workspaceCustomApplicationId =
    currentWorkspace?.workspaceCustomApplication?.id;

  const isManaged = application.id !== workspaceCustomApplicationId;

  const instanceId = `${LOGIC_FUNCTION_DETAIL_ID}-${logicFunctionId}`;

  const activeTabId = useAtomComponentStateValue(
    activeTabIdComponentState,
    instanceId,
  );

  const { formValues, logicFunction, loading, onChange } = useLogicFunctionForm(
    { logicFunctionId },
  );

  const { executeLogicFunction, isExecuting } = useExecuteLogicFunction({
    logicFunctionId,
  });

  const handleTestFunction = async () => {
    navigate('#test');
    await executeLogicFunction();
  };

  const tabs = [
    {
      id: 'editor',
      title: t`Editor`,
      Icon: IconCode,
      disabled: isManaged,
      hide: isManaged,
    },
    { id: 'settings', title: t`Settings`, Icon: IconSettings },
    { id: 'test', title: t`Test`, Icon: IconPlayerPlay },
    { id: 'triggers', title: t`Triggers`, Icon: IconBolt },
  ];

  const isEditorTab = activeTabId === 'editor';
  const isTriggersTab = activeTabId === 'triggers';
  const isSettingsTab = activeTabId === 'settings';
  const isTestTab = activeTabId === 'test';

  const breadcrumbLinks =
    isDefined(application.id) && application.id !== ''
      ? [
          {
            children: t`Workspace`,
            href: getSettingsPath(SettingsPath.Workspace),
          },
          {
            children: t`Applications`,
            href: getSettingsPath(SettingsPath.Applications),
          },
          {
            children: `${application.name} - ${t`Content`}`,
            href: getSettingsPath(
              SettingsPath.ApplicationDetail,
              {
                applicationUniversalIdentifier: application.universalIdentifier,
              },
              undefined,
              'content',
            ),
          },
          { children: `${logicFunction?.name}` },
        ]
      : [
          {
            children: t`Workspace`,
            href: getSettingsPath(SettingsPath.Workspace),
          },
          {
            children: t`AI`,
            href: getSettingsPath(SettingsPath.AI),
          },
          { children: `${logicFunction?.name}` },
        ];

  const files = [
    {
      path: 'index.ts',
      content: formValues.sourceHandlerCode,
      language: 'typescript',
    },
  ];

  return (
    !loading &&
    !applicationLoading && (
      <SubMenuTopBarContainer
        title={
          <SettingsLogicFunctionLabelContainer
            value={formValues.name}
            onChange={onChange('name')}
          />
        }
        links={breadcrumbLinks}
      >
        <SettingsPageContainer>
          <TabList tabs={tabs} componentInstanceId={instanceId} />
          {isEditorTab && (
            <SettingsLogicFunctionCodeEditorTab
              files={files}
              handleExecute={handleTestFunction}
              onChange={onChange('sourceHandlerCode')}
              isTesting={isExecuting}
            />
          )}
          {isTriggersTab && logicFunction && (
            <SettingsLogicFunctionTriggersTab logicFunction={logicFunction} />
          )}
          {isSettingsTab && (
            <SettingsLogicFunctionSettingsTab
              formValues={formValues}
              onChange={onChange}
            />
          )}
          {isTestTab && (
            <SettingsLogicFunctionTestTab
              handleExecute={executeLogicFunction}
              logicFunctionId={logicFunctionId}
              isTesting={isExecuting}
            />
          )}
        </SettingsPageContainer>
      </SubMenuTopBarContainer>
    )
  );
};
