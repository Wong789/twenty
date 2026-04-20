import {
  DETAIL_TO_FETCH_ENTITY_TYPE_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_LAST_ERROR_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_PROCESSED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_QUEUED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_RESEND_ID_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_RETRY_COUNT_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  DETAIL_TO_FETCH_TWENTY_RECORD_ID_FIELD_UNIVERSAL_IDENTIFIER,
  RESEND_DETAIL_TO_FETCH_OBJECT_UNIVERSAL_IDENTIFIER,
} from '@modules/resend/constants/universal-identifiers';
import { defineObject, FieldType } from 'twenty-sdk/define';

export default defineObject({
  universalIdentifier: RESEND_DETAIL_TO_FETCH_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'resendDetailToFetch',
  namePlural: 'resendDetailsToFetch',
  labelSingular: 'Resend detail to fetch',
  labelPlural: 'Resend details to fetch',
  description:
    'Queue of Resend records (emails, broadcasts, templates) whose detail payload still needs to be fetched from the Resend API (technical object).',
  icon: 'IconDownload',
  labelIdentifierFieldMetadataUniversalIdentifier:
    DETAIL_TO_FETCH_RESEND_ID_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier:
        DETAIL_TO_FETCH_ENTITY_TYPE_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'entityType',
      label: 'Entity type',
      description: 'Resend entity this detail row targets',
      icon: 'IconCategory',
      options: [
        {
          id: '8a715419-902c-462b-a4ae-b306f07991ed',
          value: 'EMAIL',
          label: 'Email',
          position: 0,
          color: 'purple',
        },
        {
          id: '75067d0e-735d-4506-8d4c-6cfc3b858664',
          value: 'BROADCAST',
          label: 'Broadcast',
          position: 1,
          color: 'orange',
        },
        {
          id: '8363bb17-1ec7-4c48-affc-f284180c9c53',
          value: 'TEMPLATE',
          label: 'Template',
          position: 2,
          color: 'blue',
        },
      ],
    },
    {
      universalIdentifier: DETAIL_TO_FETCH_RESEND_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'resendId',
      label: 'Resend ID',
      description: 'Identifier of the record inside Resend',
      icon: 'IconHash',
    },
    {
      universalIdentifier:
        DETAIL_TO_FETCH_TWENTY_RECORD_ID_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'twentyRecordId',
      label: 'Twenty record ID',
      description:
        'Identifier of the matching resendEmail / resendBroadcast / resendTemplate row',
      icon: 'IconLink',
    },
    {
      universalIdentifier: DETAIL_TO_FETCH_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'status',
      label: 'Status',
      description: 'Fetch status of the detail payload',
      icon: 'IconActivity',
      options: [
        {
          id: '70699a9e-8050-4f01-83d0-f064d700253b',
          value: 'PENDING',
          label: 'Pending',
          position: 0,
          color: 'yellow',
        },
        {
          id: 'fa99c827-870e-42f2-855a-dc3e931f2aff',
          value: 'DONE',
          label: 'Done',
          position: 1,
          color: 'green',
        },
        {
          id: '4fb14b4f-b024-49ee-99a2-11b294be2ed8',
          value: 'FAILED',
          label: 'Failed',
          position: 2,
          color: 'red',
        },
      ],
    },
    {
      universalIdentifier:
        DETAIL_TO_FETCH_RETRY_COUNT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.NUMBER,
      name: 'retryCount',
      label: 'Retry count',
      description: 'Number of failed fetch attempts so far',
      icon: 'IconRefresh',
    },
    {
      universalIdentifier: DETAIL_TO_FETCH_LAST_ERROR_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'lastError',
      label: 'Last error',
      description: 'Error message from the most recent failed fetch (if any)',
      icon: 'IconAlertTriangle',
    },
    {
      universalIdentifier: DETAIL_TO_FETCH_QUEUED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'queuedAt',
      label: 'Queued at',
      description: 'When the row was first queued',
      icon: 'IconClock',
    },
    {
      universalIdentifier:
        DETAIL_TO_FETCH_PROCESSED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'processedAt',
      label: 'Processed at',
      description: 'When the detail fetch completed (success or final failure)',
      icon: 'IconClockCheck',
    },
  ],
});
