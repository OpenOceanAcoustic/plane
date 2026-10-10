# Third-party components

This fork and its backend/frontend are released under AGPL-3.0-only. The application sidebar provides a source-code link to the deployed feature branch. Preserve this source offer and these notices when deploying a modified release.

| Component              | Installed version / source                                                    | License notice                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| dnd-kit                | core 6.3.1, sortable 10.0.0, utilities 3.2.2                                  | [MIT](licenses/dnd-kit.txt)                                                                      |
| Frappe Gantt           | 1.2.2, including locally scoped upstream CSS and a lifecycle disposal patch   | [MIT](licenses/frappe-gantt.txt)                                                                 |
| FullCalendar React     | 7.1.1                                                                         | [MIT](licenses/fullcalendar-standard.txt)                                                        |
| FullCalendar Scheduler | 7.1.1                                                                         | [Bundled licensing information](licenses/fullcalendar-scheduler.txt), [AGPL text](../../LICENSE) |
| temporal-polyfill      | 1.0.5                                                                         | [MIT](licenses/temporal-polyfill.txt)                                                            |
| TanStack Table         | Existing v8 installation                                                      | [MIT](licenses/tanstack-table.txt)                                                               |
| shadcn/ui              | Adapted Dialog and Select compositions from the upstream new-york-v4 registry | [MIT](licenses/shadcn-ui.txt)                                                                    |
| Radix Dialog / Select  | 1.2.0 / 2.3.8                                                                 | [Dialog MIT](licenses/radix-dialog.txt), [Select MIT](licenses/radix-select.txt)                 |
| Tiptap                 | Existing free core and local editor extensions                                | [MIT](licenses/tiptap.txt)                                                                       |
| React Flow             | 12.12.0                                                                       | [MIT](licenses/react-flow.txt)                                                                   |
| Recharts               | Existing v2 installation                                                      | [MIT](licenses/recharts.txt)                                                                     |
| react-dropzone         | 14.3.8                                                                        | [MIT](licenses/react-dropzone.txt)                                                               |
| react-markdown         | 9.1.0                                                                         | [MIT](licenses/react-markdown.txt)                                                               |

## FullCalendar Scheduler open-source route

The personnel resource calendar and horizontal timeline use FullCalendar's AGPLv3 option, with the publicly documented open-source key `AGPL-My-Frontend-And-Backend-Are-Open-Source`. This is neither a commercial license nor a trial key. The entire frontend and backend remain available as AGPL source; preserve the corresponding-source access when distributing or serving this fork. See the [official licensing terms](https://fullcalendar.io/license).

## Source and modifications

- [This Plane fork](https://github.com/OpenOceanAcoustic/plane/tree/feat/project-document-files), including backend, client, deployment instructions, dependency lockfile and patches.
- [Frappe Gantt](https://github.com/frappe/gantt): upstream CSS copied locally because the package export map does not expose its stylesheet. Selectors are scoped under `.lab-frappe-gantt`; the patch adds deterministic removal of its document mouse handler on disposal.
- [shadcn/ui registry](https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui): Dialog/Select composition adapted to Plane's existing controls, typography and theme tokens.

Third-party notices copied from installed distributions are retained verbatim under `licenses/`. The copied shadcn license is from the upstream repository. Existing upstream Plane notices and the root LICENSE remain intact.
