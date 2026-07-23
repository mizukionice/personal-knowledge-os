import { z } from 'zod';

/** ユーザーごとに制御できる機能フラグ */
export const USER_PERMISSION_FLAGS = ['can_upload', 'can_process', 'can_chat'] as const;
export type UserPermissionFlag = (typeof USER_PERMISSION_FLAGS)[number];

export interface UserProfile {
  user_id: string;
  role: 'admin' | 'user';
  can_upload: boolean;
  can_process: boolean;
  can_chat: boolean;
}

export interface AppSettings {
  signup_enabled: boolean;
  updated_at: string;
}

/** PUT /admin/settings */
export const updateAppSettingsRequestSchema = z.object({
  signup_enabled: z.boolean(),
});
export type UpdateAppSettingsRequest = z.infer<typeof updateAppSettingsRequestSchema>;

/** PATCH /admin/users/:id — 少なくとも1フィールド必須 */
export const updateUserPermissionsRequestSchema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    can_upload: z.boolean().optional(),
    can_process: z.boolean().optional(),
    can_chat: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });
export type UpdateUserPermissionsRequest = z.infer<typeof updateUserPermissionsRequestSchema>;

/** admin_list_users RPCの行 */
export interface AdminUserRow extends UserProfile {
  email: string;
  created_at: string;
}
