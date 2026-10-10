# Settings design coverage

All 39 settings screens in the V4 design have functional counterparts. Sheets and confirmation dialogs are composed within the settings route rather than separate pages.

| Design screen                 | App entry and live behavior                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings-profile-index`      | Personal settings: GET/PATCH/DELETE /api/users/me/; signed user-assets upload, confirm and remove.                                                          |
| `settings-profile`            | Personal settings: GET/PATCH/DELETE /api/users/me/; signed user-assets upload, confirm and remove.                                                          |
| `settings-avatar`             | Personal settings: GET/PATCH/DELETE /api/users/me/; signed user-assets upload, confirm and remove.                                                          |
| `settings-deactivate`         | Personal settings: GET/PATCH/DELETE /api/users/me/; signed user-assets upload, confirm and remove.                                                          |
| `settings-preferences`        | Personal settings → Preferences/theme: GET/PATCH /api/users/me/profile/; local/native theme applies immediately; safe JSON import, no configuration export. |
| `settings-theme`              | Personal settings → Preferences/theme: GET/PATCH /api/users/me/profile/; local/native theme applies immediately; safe JSON import, no configuration export. |
| `settings-custom-theme`       | Personal settings → Preferences/theme: GET/PATCH /api/users/me/profile/; local/native theme applies immediately; safe JSON import, no configuration export. |
| `settings-notifications`      | Personal settings → Notifications: GET/PATCH /api/users/me/notification-preferences/.                                                                       |
| `settings-tokens`             | Personal settings → API tokens: GET/POST /api/users/api-tokens/; DELETE detail; creation-only secret display and copy.                                      |
| `settings-token-create`       | Personal settings → API tokens: GET/POST /api/users/api-tokens/; DELETE detail; creation-only secret display and copy.                                      |
| `settings-token-delete`       | Personal settings → API tokens: GET/POST /api/users/api-tokens/; DELETE detail; creation-only secret display and copy.                                      |
| `settings-workspace-index`    | Workspace settings → General: /api/workspaces/{slug}/ CRUD, image assets; creation and deletion refresh the workspace selector.                             |
| `settings-workspace`          | Workspace settings → General: /api/workspaces/{slug}/ CRUD, image assets; creation and deletion refresh the workspace selector.                             |
| `settings-workspace-create`   | Workspace settings → General: /api/workspaces/{slug}/ CRUD, image assets; creation and deletion refresh the workspace selector.                             |
| `settings-workspace-delete`   | Workspace settings → General: /api/workspaces/{slug}/ CRUD, image assets; creation and deletion refresh the workspace selector.                             |
| `settings-members`            | Workspace settings → Members: backend roles, search, role update and confirmed removal.                                                                     |
| `settings-member-role`        | Workspace settings → Members: backend roles, search, role update and confirmed removal.                                                                     |
| `settings-member-remove`      | Workspace settings → Members: backend roles, search, role update and confirmed removal.                                                                     |
| `settings-webhooks`           | Workspace settings → Webhooks: real create/edit/delete, event flags, delivery logs and signature-key regeneration.                                          |
| `settings-webhook-edit`       | Workspace settings → Webhooks: real create/edit/delete, event flags, delivery logs and signature-key regeneration.                                          |
| `settings-project-index`      | Project settings → General: real PATCH, visibility, lead/default assignee, cover, archive/restore and confirmed deletion.                                   |
| `settings-project`            | Project settings → General: real PATCH, visibility, lead/default assignee, cover, archive/restore and confirmed deletion.                                   |
| `settings-project-delete`     | Project settings → General: real PATCH, visibility, lead/default assignee, cover, archive/restore and confirmed deletion.                                   |
| `settings-project-members`    | Project settings → Members: existing workspace members, role update, search and confirmed removal.                                                          |
| `settings-project-member-add` | Project settings → Members: existing workspace members, role update, search and confirmed removal.                                                          |
| `settings-states`             | Project settings → States: real CRUD, group/color/description and mark-default endpoint.                                                                    |
| `settings-state-edit`         | Project settings → States: real CRUD, group/color/description and mark-default endpoint.                                                                    |
| `settings-labels`             | Project settings → Labels: real CRUD, color, description and nullable parent label.                                                                         |
| `settings-label-edit`         | Project settings → Labels: real CRUD, color, description and nullable parent label.                                                                         |
| `settings-estimates`          | Project settings → Estimates: backend scheme and point CRUD; assign or disable project estimate.                                                            |
| `settings-estimate-edit`      | Project settings → Estimates: backend scheme and point CRUD; assign or disable project estimate.                                                            |
| `settings-features`           | Project settings → Features: cycle_view/module_view/issue_views_view/page_view; intake writes intake_view; inbox_view is a read-only response alias.        |
| `settings-feature-cycles`     | Project settings → Features: cycle_view/module_view/issue_views_view/page_view; intake writes intake_view; inbox_view is a read-only response alias.        |
| `settings-feature-modules`    | Project settings → Features: cycle_view/module_view/issue_views_view/page_view; intake writes intake_view; inbox_view is a read-only response alias.        |
| `settings-feature-views`      | Project settings → Features: cycle_view/module_view/issue_views_view/page_view; intake writes intake_view; inbox_view is a read-only response alias.        |
| `settings-feature-pages`      | Project settings → Features: cycle_view/module_view/issue_views_view/page_view; intake writes intake_view; inbox_view is a read-only response alias.        |
| `settings-feature-intake`     | Project settings → Features: cycle_view/module_view/issue_views_view/page_view; intake writes intake_view; inbox_view is a read-only response alias.        |
| `settings-automations`        | Project settings → Automations: archive_in/close_in, integer month counts 0–12, matching backend automation.                                                |
| `settings-token-created`      | Personal settings → API tokens: GET/POST /api/users/api-tokens/; DELETE detail; creation-only secret display and copy.                                      |

## Scope and backend restrictions

- API tokens are available with LAB session authentication, and are included.
- God Mode is removed from Android. Server-side session checks reject new and restored Android administrator sessions, including Web administrator requests carrying an Android member cookie. Computer Web administrator login remains supported; SSH generates bootstrap and single-use member registration links.
- Account language preference persists and synchronizes with the desktop application. This release uses Chinese mobile interface text.
- High-contrast presets and custom themes persist through the same existing profile.theme format. JSON configuration import is supported; mobile configuration export is absent.
- All administrative controls depend on returned membership roles and preserve backend rejection messages. Destructive project/workspace actions require the exact object name and the design confirmation phrase.
