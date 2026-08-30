import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export const profileKeys = {
  detail: (userId: string | undefined) => ['profile', userId] as const,
};

type ProfileRow = {
  username: string | null;
  display_name: string | null;
};

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.detail(userId),
    queryFn: async (): Promise<ProfileRow> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, display_name')
        .eq('id', userId as string)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });
}

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { username: string; display_name: string }) => {
      if (!userId) {
        throw new Error('Cannot update profile without a signed-in user');
      }
      const { error } = await supabase.from('profiles').update(input).eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(userId) });
    },
  });
}
