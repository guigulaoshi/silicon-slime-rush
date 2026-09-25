/** The same garage photograph identifies a vehicle in selection and final standings. */
export function carThumbnail(id: string, className = 'sm-carthumb'): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = `./garage/${id}.webp`;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.decoding = 'async';
  return image;
}
