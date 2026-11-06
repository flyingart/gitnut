// @gitnut/client: embeddable React components for gitnut daemons. Import the styles once:
//   import "@gitnut/client/styles.css";

export { GitnutConnection, GitnutRpcError, getConnection, dropConnection, normalizeUrl } from "./connection";
export type { ServerConfig, ConnectionState, ConnectionOptions } from "./connection";
export { GitnutProvider, useServers, useConnection, useConnectionState, resolveConnection, useInProvider } from "./provider";
export type { GitnutProviderProps, GitnutContextValue, ServerEntry, ServerProp } from "./provider";
export {
  useQuery,
  useQueries,
  useRepos,
  useReposOf,
  useWorktree,
  useGraph,
  useGraphSnapshot,
  useDetailsVersion,
  useCommitDetails,
  useCommitsChanges,
  useLocalChanges,
  useFileDiff,
  useSettings,
  useUpdate,
  DetailsCache,
} from "./hooks";
export type { UseGraphOptions, GraphData, FileDiffRequest, UpdatePhase } from "./hooks";
export { useViewOptions, getViewOptions, setViewOptions, setViewOptionsStorageKey } from "./viewOptions";
export type { ViewOptions, CommitColumn } from "./viewOptions";
export { CLIENT_VERSION } from "./version";
export { ErrorBoundary } from "./ui";
export { ACCENTS, accentTheme, darkTheme, lightTheme, resolveTheme, themeToCssVars, rowHeightOf } from "./theme";
export type { AccentName, GitnutTheme, GitnutThemeInput } from "./theme";
export { GitnutRoot, useGitnutTheme } from "./root";
export type { StyleProps, GitnutClassNames, GitnutSlot } from "./root";
export { buildChangesTree, flattenTree, filesOf, changesFromList } from "./tree";
export type { ChangeItem, TreeGroup, TreeNode, TreeRow, DiffSource, ChangesMode } from "./tree";
export { clickSelection, moveSelection, emptySelection } from "./selection";
export type { ListSelection } from "./selection";

export { GitnutApp } from "./GitnutApp";
export type { GitnutAppProps, AppView } from "./GitnutApp";
export { ProjectsList, WorktreeList } from "./ProjectsList";
export type { ProjectsListProps, WorktreeListProps, ProjectSelection } from "./ProjectsList";
export { CommitGraph } from "./CommitGraph";
export type { CommitGraphProps, CommitGraphController } from "./CommitGraph";
export { FilterBar } from "./graph/FilterBar";
export type { LogFilter, FilterBarProps } from "./graph/FilterBar";
export { RefsList } from "./RefsList";
export type { RefsListProps } from "./RefsList";
export { CommitDetails } from "./CommitDetails";
export type { CommitDetailsProps } from "./CommitDetails";
export { ChangesTree } from "./ChangesTree";
export type { ChangesTreeProps } from "./ChangesTree";
export { DiffViewer } from "./DiffViewer";
export type { DiffViewerProps, DiffController } from "./DiffViewer";
export { ChangesBrowser } from "./ChangesBrowser";
export type { ChangesBrowserProps } from "./ChangesBrowser";
export { LocalChanges } from "./LocalChanges";
export type { LocalChangesProps } from "./LocalChanges";
export { CombinedLocalChanges } from "./CombinedLocalChanges";
export type { CombinedLocalChangesProps, WorktreeRef } from "./CombinedLocalChanges";
export { CommitPanel } from "./CommitPanel";
export type { CommitPanelProps } from "./CommitPanel";
export { GitActions } from "./GitActions";
export {
  useGitAction,
  useLogActions,
  useLocalFileMenu,
  commitMenuItems,
  refMenuItems,
  repoMenuItems,
  copyPathItems,
  targetLabel,
  WorktreePicker,
} from "./actions";
export type { GitActionOptions, CommitMenuHandlers, RefMenuHandlers, WorktreePickerProps } from "./actions";
export { ContextMenu, useContextMenu, Dialog, isMenuKey, menuPointOf } from "./ui";
export type { MenuItem, ContextMenuProps } from "./ui";
export {
  toasts,
  createToastStore,
  useToasts,
  Toasts,
  confirmAction,
  promptAction,
  checkRefName,
  GitnutOverlays,
} from "./overlays";
export type { Toast, ToastStore, ConfirmSpec, ConfirmResult, PromptSpec, PromptResult } from "./overlays";
export type { GitActionsProps, GitAction } from "./GitActions";
export { LogView } from "./LogView";
export type { LogViewProps } from "./LogView";
export { AppearancePanel } from "./AppearancePanel";
export type { AppearancePanelProps } from "./AppearancePanel";
export { ServersPanel } from "./ServersPanel";
export type { ServersPanelProps } from "./ServersPanel";
export { SettingsPanel } from "./SettingsPanel";
export type { SettingsPanelProps } from "./SettingsPanel";
export { UpdateButton } from "./UpdateButton";
export type { UpdateButtonProps } from "./UpdateButton";
export { LoginForm } from "./LoginForm";
export type { LoginFormProps } from "./LoginForm";
export { AddProjectsDialog } from "./AddProjectsDialog";
export type { AddProjectsDialogProps } from "./AddProjectsDialog";
export { AddServerDialog } from "./AddServerDialog";
export type { AddServerDialogProps } from "./AddServerDialog";
export { Split } from "./Split";
export type { SplitProps } from "./Split";
export { Logo } from "./Logo";
export { Shortcuts } from "./Shortcuts";
