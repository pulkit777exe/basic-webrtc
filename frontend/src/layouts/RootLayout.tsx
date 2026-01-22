import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import { TOAST_POSITION, TOAST_THEME } from "../constants";

export const RootLayout: React.FC = () => {
  return (
    <>
      <Toaster position={TOAST_POSITION} theme={TOAST_THEME} />
      <div className="relative w-full h-full">
        <div className="page-enter-active animate-fade-in">
          <Outlet />
        </div>
      </div>
    </>
  );
};
