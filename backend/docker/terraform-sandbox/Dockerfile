FROM hashicorp/terraform:1.7

RUN apk add --no-cache bash

# Create non-root sandbox user
RUN adduser -D -u 1001 sandbox

# Pre-cache safe providers so terraform init works with network_disabled=True
# Providers are downloaded at image build time, not at runtime
RUN mkdir -p /usr/local/share/terraform/plugins/registry.terraform.io/hashicorp/local/2.5.1/linux_amd64 && \
    mkdir -p /usr/local/share/terraform/plugins/registry.terraform.io/hashicorp/null/3.2.2/linux_amd64 && \
    mkdir -p /usr/local/share/terraform/plugins/registry.terraform.io/hashicorp/random/3.6.0/linux_amd64

# Download provider binaries at build time (network available during build)
RUN cd /tmp && \
    wget -q "https://releases.hashicorp.com/terraform-provider-local/2.5.1/terraform-provider-local_2.5.1_linux_amd64.zip" && \
    unzip -q terraform-provider-local_2.5.1_linux_amd64.zip && \
    mv terraform-provider-local_v2.5.1_x5 /usr/local/share/terraform/plugins/registry.terraform.io/hashicorp/local/2.5.1/linux_amd64/ && \
    rm terraform-provider-local_2.5.1_linux_amd64.zip

RUN cd /tmp && \
    wget -q "https://releases.hashicorp.com/terraform-provider-null/3.2.2/terraform-provider-null_3.2.2_linux_amd64.zip" && \
    unzip -q terraform-provider-null_3.2.2_linux_amd64.zip && \
    mv terraform-provider-null_v3.2.2_x5 /usr/local/share/terraform/plugins/registry.terraform.io/hashicorp/null/3.2.2/linux_amd64/ && \
    rm terraform-provider-null_3.2.2_linux_amd64.zip

RUN cd /tmp && \
    wget -q "https://releases.hashicorp.com/terraform-provider-random/3.6.0/terraform-provider-random_3.6.0_linux_amd64.zip" && \
    unzip -q terraform-provider-random_3.6.0_linux_amd64.zip && \
    mv terraform-provider-random_v3.6.0_x5 /usr/local/share/terraform/plugins/registry.terraform.io/hashicorp/random/3.6.0/linux_amd64/ && \
    rm terraform-provider-random_3.6.0_linux_amd64.zip

# Set permissions
RUN chmod -R 755 /usr/local/share/terraform/plugins

# Terraform config: use local mirror, block registry downloads
COPY .terraformrc /root/.terraformrc
RUN cp /root/.terraformrc /home/sandbox/.terraformrc && chown sandbox:sandbox /home/sandbox/.terraformrc

WORKDIR /workspace
RUN chown sandbox:sandbox /workspace

USER sandbox
