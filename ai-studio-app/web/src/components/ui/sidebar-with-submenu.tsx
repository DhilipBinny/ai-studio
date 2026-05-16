"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CreditCard,
  HelpCircle,
  Layers,
  LayoutGrid,
  Puzzle,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MenuItem = { name: string; href: string; icon?: React.ReactNode };

const Menu = ({ children, items }: { children: React.ReactNode; items: MenuItem[] }) => {
  const [isOpened, setIsOpened] = useState(false);

  return (
    <div>
      <button
        className="w-full flex items-center justify-between text-gray-600 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 duration-150"
        onClick={() => setIsOpened((v) => !v)}
        aria-expanded={isOpened}
        aria-controls="submenu"
      >
        <div className="flex items-center gap-x-2">{children}</div>
        <ChevronDown
          className={cn("w-5 h-5 duration-150", isOpened && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {isOpened && (
        <ul id="submenu" className="mx-4 px-2 border-l text-sm font-medium">
          {items.map((item, idx) => (
            <li key={idx}>
              <a
                href={item.href}
                className="flex items-center gap-x-2 text-gray-600 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 duration-150"
              >
                {item.icon ? <div className="text-gray-500">{item.icon}</div> : null}
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const SidebarWithSubmenu = () => {
  const navigation: MenuItem[] = [
    {
      href: "#",
      name: "Overview",
      icon: <Layers className="w-5 h-5" />,
    },
    {
      href: "#",
      name: "Integration",
      icon: <Puzzle className="w-5 h-5" />,
    },
    {
      href: "#",
      name: "Plans",
      icon: <LayoutGrid className="w-5 h-5" />,
    },
    {
      href: "#",
      name: "Transactions",
      icon: <Layers className="w-5 h-5" />,
    },
  ];

  const navsFooter: MenuItem[] = [
    {
      href: "#",
      name: "Help",
      icon: <HelpCircle className="w-5 h-5" />,
    },
    {
      href: "#",
      name: "Settings",
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  const nestedNav: MenuItem[] = [
    { name: "Cards", href: "#" },
    { name: "Checkouts", href: "#" },
    { name: "Payments", href: "#" },
    { name: "Get paid", href: "#" },
  ];

  const profileRef = useRef<HTMLButtonElement | null>(null);
  const [isProfileActive, setIsProfileActive] = useState(false);

  useEffect(() => {
    const handleProfile = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileActive(false);
      }
    };
    document.addEventListener("click", handleProfile);
    return () => document.removeEventListener("click", handleProfile);
  }, []);

  return (
    <nav className="fixed top-0 left-0 w-full h-full border-r bg-white space-y-8 sm:w-80">
      <div className="flex flex-col h-full px-4">
        <div className="h-20 flex items-center pl-2">
          <div className="w-full flex items-center gap-x-4">
            <img
              src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face"
              className="w-10 h-10 rounded-full object-cover"
              alt="User avatar"
            />
            <div>
              <span className="block text-gray-700 text-sm font-semibold">Alivika Tony</span>
              <span className="block mt-px text-gray-600 text-xs">Hobby Plan</span>
            </div>

            <div className="relative flex-1 text-right">
              <button
                ref={profileRef}
                className="p-1.5 rounded-md text-gray-500 hover:bg-gray-50 active:bg-gray-100"
                onClick={() => setIsProfileActive((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={isProfileActive}
                aria-controls="profile-menu"
                aria-label="Profile menu"
              >
                <ChevronUp className="w-5 h-5" aria-hidden="true" />
              </button>

              {isProfileActive && (
                <div
                  id="profile-menu"
                  role="menu"
                  className="absolute z-10 top-12 right-0 w-64 rounded-lg bg-white shadow-md border text-sm text-gray-600"
                >
                  <div className="p-2 text-left">
                    <span className="block text-gray-500/80 p-2">alivika@gmail.com</span>
                    <a
                      href="#"
                      className="block w-full p-2 text-left rounded-md hover:bg-gray-50 active:bg-gray-100 duration-150"
                      role="menuitem"
                    >
                      Add another account
                    </a>

                    <div className="relative rounded-md hover:bg-gray-50 active:bg-gray-100 duration-150">
                      <ChevronDown
                        className="w-4 h-4 absolute right-1 inset-y-0 my-auto pointer-events-none"
                        aria-hidden="true"
                      />
                      <select
                        className="w-full cursor-pointer appearance-none bg-transparent p-2 outline-none"
                        defaultValue=""
                      >
                        <option value="" disabled hidden>
                          Theme
                        </option>
                        <option>Dark</option>
                        <option>Light</option>
                      </select>
                    </div>

                    <button className="block w-full p-2 text-left rounded-md hover:bg-gray-50 active:bg-gray-100 duration-150">
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-auto">
          <ul className="text-sm font-medium flex-1">
            {navigation.map((item, idx) => (
              <li key={idx}>
                <a
                  href={item.href}
                  className="flex items-center gap-x-2 text-gray-600 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 duration-150"
                >
                  <div className="text-gray-500">{item.icon}</div>
                  {item.name}
                </a>
              </li>
            ))}

            <li>
              <Menu items={nestedNav}>
                <CreditCard className="w-5 h-5 text-gray-500" />
                Billing
              </Menu>
            </li>
          </ul>

          <div className="pt-2 mt-2 border-t">
            <ul className="text-sm font-medium">
              {navsFooter.map((item, idx) => (
                <li key={idx}>
                  <a
                    href={item.href}
                    className="flex items-center gap-x-2 text-gray-600 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 duration-150"
                  >
                    <div className="text-gray-500">{item.icon}</div>
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default SidebarWithSubmenu;
