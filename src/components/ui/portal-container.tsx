import * as React from "react"

const PortalContainerContext = React.createContext<HTMLElement | null>(null)

function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  )
}

function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext)
}

export { PortalContainerProvider, usePortalContainer }
