export type AdminChatThread = {
  id: string;
  title: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  conversationSize: number;
  createdAt: string;
  updatedAt: string;
};
