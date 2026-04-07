import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { auth } from "./config";

const provider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
  try {
    const isMobileDevice = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobileDevice) {
       // WKWebView handles popups very poorly (orphaned blank panes). We must force a top-level redirect.
       await signInWithRedirect(auth, provider);
       return null;
    }
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const logout = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out", error);
        throw error;
    }
};
