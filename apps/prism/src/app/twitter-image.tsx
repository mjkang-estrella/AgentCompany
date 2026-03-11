import { createPrismSocialImageResponse, socialImageContentType, socialImageSize } from "@/lib/prism-social-image";

export const runtime = "nodejs";
export const contentType = socialImageContentType;
export const size = socialImageSize;
export const alt = "Prism social preview";

export default function TwitterImage() {
  return createPrismSocialImageResponse();
}
