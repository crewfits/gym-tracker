import type { Metadata } from "next"; import "@fontsource-variable/plus-jakarta-sans"; import "./globals.css";
export const metadata:Metadata={title:"GymDesk",description:"Membership and payment tracking for modern gyms"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
