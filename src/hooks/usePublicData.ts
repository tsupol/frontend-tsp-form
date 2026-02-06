import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

export interface PublicItem {
  id: number;
  msg: string;
}

export function usePublicData() {
  return useQuery({
    queryKey: ['a_public'],
    queryFn: () => apiClient.get<PublicItem[]>('/a_public', false),
  });
}
