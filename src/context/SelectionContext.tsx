import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type SelectionContextValue = {
  selectedFileIds: string[]
  setSelectedFileIds: (ids: string[]) => void
  clearSelection: () => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedFileIds, setIds] = useState<string[]>([])
  const setSelectedFileIds = useCallback((ids: string[]) => {
    setIds([...new Set(ids.filter(Boolean))])
  }, [])
  const clearSelection = useCallback(() => setIds([]), [])
  const value = useMemo(
    () => ({ selectedFileIds, setSelectedFileIds, clearSelection }),
    [selectedFileIds, setSelectedFileIds, clearSelection],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useMediaSelection() {
  const ctx = useContext(SelectionContext)
  if (!ctx) {
    return {
      selectedFileIds: [] as string[],
      setSelectedFileIds: (_ids: string[]) => {},
      clearSelection: () => {},
    }
  }
  return ctx
}
