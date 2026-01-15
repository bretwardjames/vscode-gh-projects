/**
 * Types for GitHub Projects V2 API responses
 * GitHub Projects V2 uses a flexible field system where status, priority, etc.
 * are all custom "single select" fields rather than hard-coded properties.
 */

export interface ProjectV2 {
    id: string;
    title: string;
    number: number;
    url: string;
    closed: boolean;
    shortDescription: string | null;
    owner?: {
        login: string;
        __typename: 'User' | 'Organization';
    };
    fields?: {
        nodes: ProjectField[];
    };
}

export interface ProjectField {
    __typename: string;
    id: string;
    name: string;
    options?: Array<{
        id: string;
        name: string;
        color?: string;
    }>;
}

/**
 * A saved view in a GitHub Project (Board, Table, or Roadmap layout)
 */
export interface ProjectV2View {
    id: string;
    name: string;
    number: number;
    layout: 'BOARD_LAYOUT' | 'TABLE_LAYOUT' | 'ROADMAP_LAYOUT';
    /** The field used for grouping (columns in board view) - may not be available due to API limitations */
    groupByFields?: {
        nodes: Array<{
            __typename: string;
            id: string;
            name: string;
            options?: Array<{
                id: string;
                name: string;
                color?: string;
            }>;
        }>;
    };
    /** The field used for vertical grouping (swim lanes) */
    verticalGroupByFields?: {
        nodes: Array<{
            __typename: string;
            id: string;
            name: string;
        }>;
    };
    /** Sort configuration */
    sortByFields?: {
        nodes: Array<{
            __typename: string;
            field: {
                id: string;
                name: string;
            };
            direction: 'ASC' | 'DESC';
        }>;
    };
    /** Filter applied to this view */
    filter?: string | null;
}

/**
 * Extended project info with views and fields
 */
export interface ProjectWithViews extends ProjectV2 {
    views: ProjectV2View[];
    fields: {
        nodes: ProjectField[];
    };
}

/**
 * Extended project info with available status values for mapping
 * @deprecated Use ProjectWithViews instead
 */
export interface ProjectWithFields extends ProjectV2 {
    statusField: ProjectField | null;
    statusOptions: string[];
}

export interface ProjectV2Item {
    id: string;
    type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
    content: ProjectItemContent | null;
    fieldValues: FieldValueConnection;
}

export interface ProjectItemContent {
    __typename: 'Issue' | 'PullRequest' | 'DraftIssue';
    title: string;
    number?: number;
    url?: string;
    state?: 'OPEN' | 'CLOSED' | 'MERGED';
    repository?: {
        name: string;
        owner: {
            login: string;
        };
    };
    assignees?: {
        nodes: Array<{
            login: string;
            avatarUrl: string;
        }>;
    };
}

export interface FieldValueConnection {
    nodes: FieldValue[];
}

export type FieldValue =
    | SingleSelectFieldValue
    | TextFieldValue
    | DateFieldValue
    | NumberFieldValue
    | IterationFieldValue;

export interface SingleSelectFieldValue {
    __typename: 'ProjectV2ItemFieldSingleSelectValue';
    name: string;
    field: {
        name: string;
    };
}

export interface TextFieldValue {
    __typename: 'ProjectV2ItemFieldTextValue';
    text: string;
    field: {
        name: string;
    };
}

export interface DateFieldValue {
    __typename: 'ProjectV2ItemFieldDateValue';
    date: string;
    field: {
        name: string;
    };
}

export interface NumberFieldValue {
    __typename: 'ProjectV2ItemFieldNumberValue';
    number: number;
    field: {
        name: string;
    };
}

export interface IterationFieldValue {
    __typename: 'ProjectV2ItemFieldIterationValue';
    title: string;
    startDate: string;
    duration: number;
    field: {
        name: string;
    };
}

export interface ProjectsQueryResponse {
    viewer: {
        login: string;
        projectsV2: {
            nodes: ProjectV2[];
        };
    };
}

export interface ProjectItemsQueryResponse {
    node: {
        items: {
            pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
            };
            nodes: ProjectV2Item[];
        };
    };
}

export interface UserProjectItemsResponse {
    viewer: {
        login: string;
    };
    node: {
        items: {
            pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
            };
            nodes: ProjectV2Item[];
        };
    };
}

/**
 * Parsed/normalized project item for display in the tree view
 */
export interface LabelInfo {
    name: string;
    color: string | null;
}

export interface FieldInfo {
    value: string;
    color: string | null;
}

export interface AssigneeInfo {
    login: string;
    avatarUrl: string | null;
}

export interface NormalizedProjectItem {
    id: string;
    title: string;
    type: 'issue' | 'pr' | 'draft';
    status: string | null;
    url: string | null;
    number: number | null;
    repository: string | null;
    assignees: AssigneeInfo[];
    labels: LabelInfo[];
    state: 'open' | 'closed' | 'merged' | null;
    fields: Map<string, FieldInfo>;
    issueType: string | null;
}

/**
 * Configuration for connecting to a GitHub Project
 */
export interface ProjectConfig {
    owner: string;
    projectNumber: number;
    type: 'user' | 'organization';
}

/**
 * User-defined mapping of project statuses to normalized display categories
 */
export interface StatusMapping {
    /** The normalized category name shown in the sidebar (e.g., "In Progress") */
    displayName: string;
    /** Sort order for this category (lower = higher in list) */
    order: number;
    /** Icon to show (VS Code ThemeIcon name) */
    icon?: string;
    /** Color for the icon */
    color?: string;
}

/**
 * Configuration for a single project's status mapping
 */
export interface ProjectStatusConfig {
    projectId: string;
    projectTitle: string;
    enabled: boolean;
    /** Maps original status values to normalized display names */
    statusMappings: Record<string, string>;
}

/**
 * Full extension configuration stored in workspace/user settings
 */
export interface GHProjectsConfig {
    /** Normalized status categories and their display settings */
    statusCategories: Record<string, StatusMapping>;
    /** Per-project configuration */
    projects: Record<string, ProjectStatusConfig>;
}
