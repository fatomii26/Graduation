export default function MerchPic({ image, name }: { image: string; name: string }) {
  const isUrl = /^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/.test(image);
  return (
    <div className="merch-pic">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {isUrl ? <img src={image} alt={name} /> : <span aria-hidden="true">{image || '🎓'}</span>}
    </div>
  );
}
