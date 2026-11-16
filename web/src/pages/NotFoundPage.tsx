import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

/** 404 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="页面不存在或已被移除"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          回到密码本
        </Button>
      }
    />
  );
}
