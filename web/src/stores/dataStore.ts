import { create } from 'zustand';
import { listCategories, listEntries } from '../api';
import type { Category, EntryListItem, Pagination } from '../types';

interface FilterPatch {
  categoryId?: string | undefined;
  favoriteOnly?: boolean;
  keyword?: string;
}

interface DataState {
  categories: Category[];
  entries: EntryListItem[];
  pagination: Pagination;
  keyword: string;
  categoryId?: string | undefined;
  favoriteOnly: boolean;
  page: number;
  size: number;
  loading: boolean;
  /** 加载分类（含条目计数） */
  loadCategories: () => Promise<void>;
  /** 更新筛选条件并回到第一页重新加载 */
  setFilter: (patch: FilterPatch) => void;
  /** 加载条目（可用 patch 临时覆盖页码等） */
  loadEntries: (patch?: Partial<FilterPatch & { page: number; size: number }>) => Promise<void>;
}

const DEFAULT_PAGINATION: Pagination = { page: 1, size: 20, total: 0 };

export const useDataStore = create<DataState>((set, get) => ({
  categories: [],
  entries: [],
  pagination: DEFAULT_PAGINATION,
  keyword: '',
  categoryId: undefined,
  favoriteOnly: false,
  page: 1,
  size: 20,
  loading: false,

  loadCategories: async () => {
    try {
      const categories = await listCategories();
      set({ categories });
    } catch (err) {
      console.error('加载分类失败', err);
    }
  },

  setFilter: (patch) => {
    const next = { ...patch, page: 1 };
    set(next as Partial<DataState>);
    void get().loadEntries(next);
  },

  loadEntries: async (patch) => {
    if (patch) set(patch as Partial<DataState>);
    const s = get();
    set({ loading: true });
    try {
      const res = await listEntries({
        page: s.page,
        size: s.size,
        keyword: s.keyword || undefined,
        categoryId: s.categoryId,
        favorite: s.favoriteOnly || undefined,
      });
      set({ entries: res.data, pagination: res.pagination, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },
}));

export default useDataStore;
