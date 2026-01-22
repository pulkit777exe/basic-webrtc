import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "../layouts/RootLayout";
import { HomePage } from "../pages/HomePage";
import { RoomPage } from "../pages/RoomPage";
import { LoginPage } from "../pages/LoginPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "room/:roomId",
        element: <RoomPage />,
      },
      {
        path: "login",
        element: <LoginPage />,
      },
    ],
  },
]);
