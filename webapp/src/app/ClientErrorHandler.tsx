 'use client';
 
 import { useEffect } from 'react';
 import { toast } from 'sonner';
 
 export default function ClientErrorHandler() {
   useEffect(() => {
     const handleRejection = (event: PromiseRejectionEvent) => {
       const message = String(event.reason?.message || event.reason || '');
       if (
         message.includes('Unexpected response') ||
         message.includes('Invalid Server Actions request') ||
         message.includes('Failed to find Server Action')
       ) {
         toast.error('App updated. Reloading to sync latest version...');
         setTimeout(() => {
           if (typeof window !== 'undefined') {
             window.location.reload();
           }
         }, 1200);
       }
     };
 
     window.addEventListener('unhandledrejection', handleRejection);
     return () => {
       window.removeEventListener('unhandledrejection', handleRejection);
     };
   }, []);
 
   return null;
 }
