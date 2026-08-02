import React from "react"
import './globals.css'

export default function LandingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="font-sans antialiased">
      {children}
    </div>
  )
}
