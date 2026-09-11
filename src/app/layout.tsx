import type { Metadata, Viewport } from "next"; import "@fontsource-variable/plus-jakarta-sans"; import "./globals.css";
import { PwaRegistration } from "@/components/pwa-registration";
export const metadata:Metadata={title:"FitKiro",description:"Membership and payment tracking for modern gyms",applicationName:"FitKiro Scanner",icons:{icon:[{url:"/icons/fitkiro-scanner-192.png",sizes:"192x192",type:"image/png"},{url:"/icons/fitkiro-scanner-512.png",sizes:"512x512",type:"image/png"}],apple:"/icons/fitkiro-scanner-192.png"},appleWebApp:{capable:true,statusBarStyle:"default",title:"FitKiro Scanner"}};
export const viewport:Viewport={themeColor:"#102a56",width:"device-width",initialScale:1,viewportFit:"cover"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><PwaRegistration/>{children}</body></html>}
