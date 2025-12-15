/**
 * Hook for managing pagination state
 */
import { useState, useMemo, useCallback } from 'react';

export interface UsePaginationOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

export interface UsePaginationReturn<T> {
  /** Current page (1-indexed) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Available page size options */
  pageSizeOptions: number[];
  /** Total number of pages */
  totalPages: number;
  /** Total number of items */
  totalItems: number;
  /** Start index for current page (0-indexed) */
  startIndex: number;
  /** End index for current page (exclusive) */
  endIndex: number;
  /** Items for current page */
  paginatedItems: T[];
  /** Whether there's a previous page */
  hasPrevious: boolean;
  /** Whether there's a next page */
  hasNext: boolean;
  /** Go to specific page */
  setPage: (page: number) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  previousPage: () => void;
  /** Change page size (resets to page 1) */
  setPageSize: (size: number) => void;
  /** Reset to first page */
  reset: () => void;
}

const DEFAULT_PAGE_SIZES = [25, 50, 100, 200];

/**
 * Hook for managing client-side pagination
 */
export function usePagination<T>(
  items: T[],
  options: UsePaginationOptions = {}
): UsePaginationReturn<T> {
  const {
    defaultPage = 1,
    defaultPageSize = 50,
    pageSizeOptions = DEFAULT_PAGE_SIZES,
  } = options;

  const [page, setPageState] = useState(defaultPage);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Ensure page is within bounds
  const validPage = Math.min(Math.max(1, page), totalPages);
  if (validPage !== page) {
    setPageState(validPage);
  }

  const startIndex = (validPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const paginatedItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  );

  const hasPrevious = validPage > 1;
  const hasNext = validPage < totalPages;

  const setPage = useCallback((newPage: number) => {
    setPageState(Math.min(Math.max(1, newPage), totalPages));
  }, [totalPages]);

  const nextPage = useCallback(() => {
    if (hasNext) setPageState((p) => p + 1);
  }, [hasNext]);

  const previousPage = useCallback(() => {
    if (hasPrevious) setPageState((p) => p - 1);
  }, [hasPrevious]);

  const setPageSize = useCallback((newSize: number) => {
    setPageSizeState(newSize);
    setPageState(1); // Reset to first page when changing page size
  }, []);

  const reset = useCallback(() => {
    setPageState(1);
  }, []);

  return {
    page: validPage,
    pageSize,
    pageSizeOptions,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
    paginatedItems,
    hasPrevious,
    hasNext,
    setPage,
    nextPage,
    previousPage,
    setPageSize,
    reset,
  };
}

export default usePagination;
