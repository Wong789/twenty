import type { CoreApiClient } from 'twenty-client-sdk/core';

export type UpsertRecordsOptions<
  TListItem,
  TDetail = TListItem,
  TCreateDto extends Record<string, unknown> = Record<string, unknown>,
  TUpdateDto extends Record<string, unknown> = Record<string, unknown>,
> = {
  items: TListItem[];
  getId: (item: TListItem) => string;
  fetchDetail?: (id: string) => Promise<TDetail>;
  fetchDetailOnlyForCreate?: boolean;
  mapCreateData: (detail: TDetail, item: TListItem) => TCreateDto;
  mapUpdateData: (detail: TDetail, item: TListItem) => TUpdateDto;
  client: CoreApiClient;
  objectNameSingular: string;
  objectNamePlural: string;
};
