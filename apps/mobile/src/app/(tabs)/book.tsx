import { BodyText, Card, Screen, Title } from '../../components/ui';

export default function BookScreen() {
  return (
    <Screen>
      <Title>生活簿</Title>
      <Card>
        <BodyText bold>还没有记录。</BodyText>
        <BodyText muted>重复日常、重要日期和备忘都会收在这里。</BodyText>
      </Card>
    </Screen>
  );
}
