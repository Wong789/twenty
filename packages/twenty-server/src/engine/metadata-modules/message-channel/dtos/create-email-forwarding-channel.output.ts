import { Field, ObjectType } from '@nestjs/graphql';

import { MessageChannelDTO } from 'src/engine/metadata-modules/message-channel/dtos/message-channel.dto';

@ObjectType('CreateEmailForwardingChannelOutput')
export class CreateEmailForwardingChannelOutput {
  @Field(() => MessageChannelDTO)
  messageChannel: MessageChannelDTO;

  @Field()
  forwardingAddress: string;
}
