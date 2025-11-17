
export enum ChatRole {
  USER = 'user',
  AI = 'ai',
  SYSTEM = 'system',
}

export interface GroundingSource {
  title: string;
  uri: string;
  type: 'search' | 'maps';
}

export interface Message {
  id: string;
  role: ChatRole;
  text: string;
  sources?: GroundingSource[];
  isLoading?: boolean;
}
