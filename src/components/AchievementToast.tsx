export function AchievementToast({ title, description }: { title: string; description: string }) {
  return (
    <div className="achievement-toast">
      <span className="eyebrow">Achievement unlocked</span>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
