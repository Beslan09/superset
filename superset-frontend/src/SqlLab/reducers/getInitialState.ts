/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { t } from '@superset-ui/core';
import getToastsFromPyFlashMessages from 'src/components/MessageToasts/getToastsFromPyFlashMessages';
import type { BootstrapData } from 'src/types/bootstrapTypes';
import type { InitialState } from 'src/hooks/apiResources/sqlLab';
import type {
  QueryEditor,
  UnsavedQueryEditor,
  SqlLabRootState,
  Table,
} from 'src/SqlLab/types';

export function dedupeTabHistory(tabHistory: string[]) {
  return tabHistory.reduce<string[]>(
    (result, tabId) =>
      result.slice(-1)[0] === tabId ? result : result.concat(tabId),
    [],
  );
}

export default function getInitialState({
  common,
  active_tab: activeTab,
  tab_state_ids: tabStateIds = [],
  databases,
  queries: queries_,
  user,
}: BootstrapData & Partial<InitialState>) {
  /**
   * Before YYYY-MM-DD, the state for SQL Lab was stored exclusively in the
   * browser's localStorage. The feature flag `SQLLAB_BACKEND_PERSISTENCE`
   * moves the state to the backend instead, migrating it from local storage.
   *
   * To allow for a transparent migration, the initial state is a combination
   * of the backend state (if any) with the browser state (if any).
   */
  let queryEditors: Record<string, QueryEditor> = {};
  const defaultQueryEditor = {
    loaded: true,
    name: t('Untitled query'),
    sql: 'SELECT *\nFROM\nWHERE',
    latestQueryId: null,
    autorun: false,
    dbId: common.conf.SQLLAB_DEFAULT_DBID,
    queryLimit: common.conf.DEFAULT_SQLLAB_LIMIT,
    hideLeftBar: false,
    remoteId: null,
  };
  let unsavedQueryEditor: UnsavedQueryEditor = {};

  /**
   * Load state from the backend. This will be empty if the feature flag
   * `SQLLAB_BACKEND_PERSISTENCE` is off.
   */
  tabStateIds.forEach(({ id, label }) => {
    let queryEditor: QueryEditor;
    if (activeTab && activeTab.id === id) {
      queryEditor = {
        id: id.toString(),
        loaded: true,
        name: activeTab.label,
        sql: activeTab.sql || '',
        selectedText: undefined,
        latestQueryId: activeTab.latest_query
          ? activeTab.latest_query.id
          : null,
        remoteId: activeTab.saved_query?.id || null,
        autorun: Boolean(activeTab.autorun),
        templateParams: activeTab.template_params || undefined,
        dbId: activeTab.database_id,
        schema: activeTab.schema,
        queryLimit: activeTab.query_limit,
        hideLeftBar: activeTab.hide_left_bar,
      };
    } else {
      // dummy state, actual state will be loaded on tab switch
      queryEditor = {
        ...defaultQueryEditor,
        id: id.toString(),
        loaded: false,
        name: label,
      };
    }
    queryEditors = {
      ...queryEditors,
      [queryEditor.id]: queryEditor,
    };
  });

  const tabHistory = activeTab ? [activeTab.id.toString()] : [];
  let tables = {} as Record<string, Table>;
  const editorTabLastUpdatedAt = Date.now();
  if (activeTab) {
    activeTab.table_schemas
      .filter(tableSchema => tableSchema.description !== null)
      .forEach(tableSchema => {
        const { dataPreviewQueryId, ...persistData } = tableSchema.description;
        const table = {
          dbId: tableSchema.database_id,
          queryEditorId: tableSchema.tab_state_id.toString(),
          schema: tableSchema.schema,
          name: tableSchema.table,
          expanded: tableSchema.expanded,
          id: tableSchema.id,
          dataPreviewQueryId,
          persistData,
          initialized: true,
        };
        tables = {
          ...tables,
          [table.id]: table,
        };
      });
  }

  const queries = { ...queries_ };

  /**
   * If the `SQLLAB_BACKEND_PERSISTENCE` feature flag is off, or if the user
   * hasn't used SQL Lab after it has been turned on, the state will be stored
   * in the browser's local storage.
   */
  const localStorageData = localStorage.getItem('redux');
  const sqlLabCacheData = localStorageData
    ? (JSON.parse(localStorageData) as Pick<SqlLabRootState, 'sqlLab'>)
    : undefined;
  if (localStorageData && sqlLabCacheData?.sqlLab) {
    const { sqlLab } = sqlLabCacheData;

    if (sqlLab.queryEditors.length === 0) {
      // migration was successful
      localStorage.removeItem('redux');
    } else {
      unsavedQueryEditor = sqlLab.unsavedQueryEditor || unsavedQueryEditor;
      // add query editors and tables to state with a special flag so they can
      // be migrated if the `SQLLAB_BACKEND_PERSISTENCE` feature flag is on
      sqlLab.queryEditors.forEach(qe => {
        queryEditors = {
          ...queryEditors,
          [qe.id]: {
            ...queryEditors[qe.id],
            ...qe,
            name: qe.title || qe.name,
            ...(unsavedQueryEditor.id === qe.id && unsavedQueryEditor),
            inLocalStorage: true,
            loaded: true,
          },
        };
      });
      const expandedTables = new Set();
      tables = sqlLab.tables.reduce((merged, table) => {
        const expanded = !expandedTables.has(table.queryEditorId);
        if (expanded) {
          expandedTables.add(table.queryEditorId);
        }
        return {
          ...merged,
          [table.id]: {
            ...tables[table.id],
            ...table,
            expanded,
          },
        };
      }, tables);
      Object.values(sqlLab.queries).forEach(query => {
        queries[query.id] = { ...query, inLocalStorage: true };
      });
      tabHistory.push(...sqlLab.tabHistory);
    }
  }

  return {
    sqlLab: {
      activeSouthPaneTab: 'Results',
      alerts: [],
      databases,
      offline: false,
      queries,
      queryEditors: Object.values(queryEditors),
      tabHistory: dedupeTabHistory(tabHistory),
      tables: Object.values(tables),
      queriesLastUpdate: Date.now(),
      editorTabLastUpdatedAt,
      queryCostEstimates: {},
      unsavedQueryEditor,
    },
    messageToasts: getToastsFromPyFlashMessages(
      (common || {})?.flash_messages || [],
    ),
    localStorageUsageInKilobytes: 0,
    common: {
      flash_messages: common.flash_messages,
      conf: common.conf,
    },
    user,
  };
}
