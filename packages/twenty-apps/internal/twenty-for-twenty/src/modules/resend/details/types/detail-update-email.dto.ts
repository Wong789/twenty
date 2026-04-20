export type DetailUpdateEmailDto = {
  htmlBody: string;
  textBody: string;
  tags: Array<{ name: string; value: string }> | undefined;
};
