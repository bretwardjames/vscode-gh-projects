import * as vscode from 'vscode';
import { GitHubAPI } from './github-api';
import type {
    NormalizedProjectItem,
    ProjectWithViews,
    ProjectV2View,
} from './types';

/**
 * Tree element types - mirrors GitHub's hierarchy:
 * Project → View → Column → Item
 */
export type TreeElement = ProjectNode | ViewNode | ColumnNode | ItemNode | MessageNode;

export class ProjectNode {
    readonly type = 'project' as const;
    constructor(public readonly project: ProjectWithViews) {}
}

export class ViewNode {
    readonly type = 'view' as const;
    constructor(
        public readonly view: ProjectV2View,
        public readonly project: ProjectWithViews
    ) {}
}

export class ColumnNode {
    readonly type = 'column' as const;
    constructor(
        public readonly name: string,
        public readonly color: string | undefined,
        public readonly items: NormalizedProjectItem[],
        public readonly view: ProjectV2View,
        public readonly project: ProjectWithViews
    ) {}
}

export class ItemNode {
    readonly type = 'item' as const;
    constructor(
        public readonly item: NormalizedProjectItem,
        public readonly project: ProjectWithViews
    ) {}
}

export class MessageNode {
    readonly type = 'message' as const;
    constructor(
        public readonly message: string,
        public readonly action?: { command: string; title: string }
    ) {}
}

/**
 * Main tree provider that shows GitHub Projects with their actual views
 * Mirrors the GitHub UI: Projects → Views → Columns → Items
 */
export class ProjectBoardProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private projects: ProjectWithViews[] = [];
    private projectItems: Map<string, NormalizedProjectItem[]> = new Map();
    private loading = false;
    private selectedViewId: string | null = null;

    constructor(private api: GitHubAPI) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    async setProjects(projects: ProjectWithViews[]): Promise<void> {
        this.projects = projects;
        this.projectItems.clear();
        this.refresh();
    }

    setLoading(loading: boolean): void {
        this.loading = loading;
        this.refresh();
    }

    /**
     * Load items for a specific project
     */
    async loadProjectItems(project: ProjectWithViews): Promise<NormalizedProjectItem[]> {
        if (this.projectItems.has(project.id)) {
            return this.projectItems.get(project.id)!;
        }

        const config = vscode.workspace.getConfiguration('ghProjects');
        const assignedToMe = config.get<boolean>('showOnlyAssignedToMe', true);

        // Find the groupBy field name from the first board view
        const boardView = project.views.find((v) => v.layout === 'BOARD_LAYOUT');
        const groupByField = boardView?.groupByFields.nodes[0];
        const statusFieldName = groupByField?.name || 'Status';

        const items = await this.api.getProjectItems(project.id, {
            assignedToMe,
            statusFieldName,
        });

        this.projectItems.set(project.id, items);
        return items;
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        switch (element.type) {
            case 'project':
                return this.createProjectTreeItem(element);
            case 'view':
                return this.createViewTreeItem(element);
            case 'column':
                return this.createColumnTreeItem(element);
            case 'item':
                return this.createItemTreeItem(element);
            case 'message':
                return this.createMessageTreeItem(element);
        }
    }

    async getChildren(element?: TreeElement): Promise<TreeElement[]> {
        // Root level - show projects
        if (!element) {
            if (!this.api.isAuthenticated) {
                return [
                    new MessageNode('Sign in to GitHub to view projects', {
                        command: 'ghProjects.signIn',
                        title: 'Sign In',
                    }),
                ];
            }

            if (this.loading) {
                return [new MessageNode('Loading projects...')];
            }

            if (this.projects.length === 0) {
                return [
                    new MessageNode('No projects found for this repository'),
                    new MessageNode('Check access permissions', {
                        command: 'ghProjects.showAccessHelp',
                        title: 'Help',
                    }),
                ];
            }

            return this.projects.map((p) => new ProjectNode(p));
        }

        // Project level - show views
        if (element.type === 'project') {
            const views = element.project.views;
            if (views.length === 0) {
                return [new MessageNode('No views configured')];
            }

            // Prioritize board views, but show all
            const sorted = [...views].sort((a, b) => {
                if (a.layout === 'BOARD_LAYOUT' && b.layout !== 'BOARD_LAYOUT') return -1;
                if (b.layout === 'BOARD_LAYOUT' && a.layout !== 'BOARD_LAYOUT') return 1;
                return a.number - b.number;
            });

            return sorted.map((v) => new ViewNode(v, element.project));
        }

        // View level - show columns (for board) or items (for table)
        if (element.type === 'view') {
            const items = await this.loadProjectItems(element.project);

            if (element.view.layout === 'BOARD_LAYOUT') {
                return this.getColumnsForView(element.view, element.project, items);
            } else {
                // For table/roadmap views, just show items directly
                return items.map((item) => new ItemNode(item, element.project));
            }
        }

        // Column level - show items in that column
        if (element.type === 'column') {
            return element.items.map((item) => new ItemNode(item, element.project));
        }

        return [];
    }

    /**
     * Get columns for a board view based on its groupBy field
     */
    private getColumnsForView(
        view: ProjectV2View,
        project: ProjectWithViews,
        items: NormalizedProjectItem[]
    ): ColumnNode[] {
        const groupByField = view.groupByFields.nodes[0];
        if (!groupByField) {
            // No groupBy - show all items in one column
            return [new ColumnNode('All Items', undefined, items, view, project)];
        }

        const fieldName = groupByField.name;
        const columns: ColumnNode[] = [];

        // Get the field options (these define the column order)
        const options = 'options' in groupByField && groupByField.options
            ? groupByField.options
            : [];

        // Group items by their value for this field
        const itemsByColumn = new Map<string, NormalizedProjectItem[]>();

        for (const item of items) {
            const columnValue = item.fields.get(fieldName) || 'No Status';
            if (!itemsByColumn.has(columnValue)) {
                itemsByColumn.set(columnValue, []);
            }
            itemsByColumn.get(columnValue)!.push(item);
        }

        // Create columns in the order defined by field options
        for (const option of options) {
            const columnItems = itemsByColumn.get(option.name) || [];
            columns.push(new ColumnNode(option.name, option.color, columnItems, view, project));
            itemsByColumn.delete(option.name);
        }

        // Add any remaining columns (items with values not in options)
        for (const [name, columnItems] of itemsByColumn) {
            columns.push(new ColumnNode(name, undefined, columnItems, view, project));
        }

        return columns;
    }

    // Tree item creators
    private createProjectTreeItem(node: ProjectNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.project.title,
            vscode.TreeItemCollapsibleState.Expanded
        );
        item.iconPath = new vscode.ThemeIcon('project');
        item.contextValue = 'project';
        item.description = `${node.project.views.length} view${node.project.views.length !== 1 ? 's' : ''}`;

        if (node.project.shortDescription) {
            item.tooltip = new vscode.MarkdownString(
                `**${node.project.title}**\n\n${node.project.shortDescription}`
            );
        }

        return item;
    }

    private createViewTreeItem(node: ViewNode): vscode.TreeItem {
        const layoutIcons: Record<string, string> = {
            'BOARD_LAYOUT': 'layout',
            'TABLE_LAYOUT': 'table',
            'ROADMAP_LAYOUT': 'calendar',
        };

        const layoutNames: Record<string, string> = {
            'BOARD_LAYOUT': 'Board',
            'TABLE_LAYOUT': 'Table',
            'ROADMAP_LAYOUT': 'Roadmap',
        };

        const item = new vscode.TreeItem(
            node.view.name,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        item.iconPath = new vscode.ThemeIcon(layoutIcons[node.view.layout] || 'list-flat');
        item.description = layoutNames[node.view.layout] || node.view.layout;
        item.contextValue = 'view';

        // Show groupBy info in tooltip
        const groupBy = node.view.groupByFields.nodes[0];
        if (groupBy) {
            item.tooltip = `Grouped by: ${groupBy.name}`;
        }

        return item;
    }

    private createColumnTreeItem(node: ColumnNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.name,
            node.items.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        item.description = `${node.items.length}`;
        item.contextValue = 'column';

        // Use GitHub's color if available
        item.iconPath = this.getColumnIcon(node.name, node.color);

        return item;
    }

    private getColumnIcon(name: string, color?: string): vscode.ThemeIcon {
        // Map GitHub colors to VS Code theme colors
        const colorMap: Record<string, string> = {
            'GRAY': 'charts.gray',
            'BLUE': 'charts.blue',
            'GREEN': 'charts.green',
            'YELLOW': 'charts.yellow',
            'ORANGE': 'charts.orange',
            'RED': 'charts.red',
            'PINK': 'charts.pink',
            'PURPLE': 'charts.purple',
        };

        const themeColor = color ? colorMap[color.toUpperCase()] : undefined;

        // Also try to infer from name if no color
        const nameLower = name.toLowerCase();
        let icon = 'circle-filled';

        if (nameLower.includes('done') || nameLower.includes('complete')) {
            return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
        }
        if (nameLower.includes('progress') || nameLower.includes('doing')) {
            return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'));
        }
        if (nameLower.includes('review')) {
            return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple'));
        }
        if (nameLower.includes('block')) {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        }

        return new vscode.ThemeIcon(
            icon,
            themeColor ? new vscode.ThemeColor(themeColor) : undefined
        );
    }

    private createItemTreeItem(node: ItemNode): vscode.TreeItem {
        const { item } = node;
        const treeItem = new vscode.TreeItem(item.title, vscode.TreeItemCollapsibleState.None);

        // Description: repo#number
        if (item.repository && item.number) {
            treeItem.description = `${item.repository}#${item.number}`;
        } else if (item.number) {
            treeItem.description = `#${item.number}`;
        }

        // Icon based on type and state
        treeItem.iconPath = this.getItemIcon(item);
        treeItem.contextValue = 'projectItem';

        // Tooltip with details
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${item.title}**\n\n`);
        if (item.status) md.appendMarkdown(`Status: ${item.status}\n\n`);
        if (item.assignees.length > 0) {
            md.appendMarkdown(`Assignees: ${item.assignees.join(', ')}\n\n`);
        }
        treeItem.tooltip = md;

        // Click to open in browser
        if (item.url) {
            treeItem.command = {
                command: 'ghProjects.openItem',
                title: 'Open in Browser',
                arguments: [item.url],
            };
        }

        return treeItem;
    }

    private getItemIcon(item: NormalizedProjectItem): vscode.ThemeIcon {
        if (item.type === 'pr') {
            if (item.state === 'merged') {
                return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.purple'));
            }
            if (item.state === 'closed') {
                return new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('charts.red'));
            }
            return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.green'));
        }

        if (item.type === 'draft') {
            return new vscode.ThemeIcon('note');
        }

        // Issue
        if (item.state === 'closed') {
            return new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('charts.purple'));
        }
        return new vscode.ThemeIcon('issue-opened', new vscode.ThemeColor('charts.green'));
    }

    private createMessageTreeItem(node: MessageNode): vscode.TreeItem {
        const item = new vscode.TreeItem(node.message);
        if (node.action) {
            item.command = {
                command: node.action.command,
                title: node.action.title,
            };
        }
        return item;
    }
}
