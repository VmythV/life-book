import { BodyText, Card, Screen, Title } from '../../components/ui';

export default function HomeScreen() {
  return (
    <Screen>
      <Title>家中</Title>
      <Card>
        <BodyText bold>还没有家庭物品。</BodyText>
        <BodyText muted>以后可以在这里记下家里东西的数量和存放位置。</BodyText>
      </Card>
    </Screen>
  );
}
