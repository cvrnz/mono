import { useEffect, useState } from 'react'

/** A URL for a blob that lives as long as the component shows it. */
export function useBlobUrl(blob: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    // oxlint-disable-next-line react/set-state-in-effect -- the URL is made and revoked with the effect
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
