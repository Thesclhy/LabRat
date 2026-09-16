import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE = "labrat:public-route";
export const PLATFORM_ADMIN_ROUTE = "labrat:platform-admin-route";

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_ROUTE, true);
