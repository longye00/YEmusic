/** 在线平台登录对话框（设置页等乐库以外的地方使用；乐库里在书签中登录） */
import { ACCOUNT_META, type AccountPlatform } from '@/store/accounts';
import { Modal } from '../components/common';
import { LoginPanel } from './LoginPanel';

export function LoginDialog({ platform, onClose }: { platform: AccountPlatform; onClose: () => void }) {
    return (
        <Modal open onClose={onClose} title={`登录${ACCOUNT_META[platform].name}`}>
            <LoginPanel platform={platform} variant="dialog" onDone={onClose} onClose={onClose} />
        </Modal>
    );
}
